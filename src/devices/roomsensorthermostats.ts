/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * roomsensorthermostats.ts: homebridge-resideo.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { ResideoPlatform } from '../platform.js'
import type { accessoryValue, devicesConfig, location, payload, resideoDevice, sensorAccessory, T9groups } from '../settings.js'

// import { request } from 'undici';
import { interval, Subject } from 'rxjs'
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators'

import { DeviceURL } from '../settings.js'
import { HomeKitModes, ResideoModes, toCelsius, toFahrenheit } from '../utils.js'
import { deviceBase } from './device.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RoomSensorThermostat extends deviceBase {
  // Services
  private Thermostat: {
    Name: CharacteristicValue
    Service: Service
    TargetTemperature: CharacteristicValue
    CurrentTemperature: CharacteristicValue
    TemperatureDisplayUnits: CharacteristicValue
    TargetHeatingCoolingState: CharacteristicValue
    CurrentHeatingCoolingState: CharacteristicValue
    CoolingThresholdTemperature: CharacteristicValue
    HeatingThresholdTemperature: CharacteristicValue
  }

  private HumiditySensor?: {
    Name: CharacteristicValue
    Service: Service
    CurrentRelativeHumidity: CharacteristicValue
  }

  // Others - T9 Only
  roomPriorityStatus: any

  // Thermostat Update
  thermostatUpdateInProgress!: boolean
  doThermostatUpdate!: Subject<void>

  // Room Updates
  roomUpdateInProgress!: boolean
  doRoomUpdate!: Subject<void>

  // Fan Updates
  fanUpdateInProgress!: boolean
  doFanUpdate!: Subject<void>

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    location: location,
    device: resideoDevice & devicesConfig,
    sensorAccessory: sensorAccessory,
    readonly group: T9groups,
  ) {
    super(platform, accessory, location, device, sensorAccessory, group)

    // this is subject we use to track when we need to POST Room Priority changes to the Resideo API for Room Changes - T9 Only
    this.doRoomUpdate = new Subject()
    this.roomUpdateInProgress = false
    // this is subject we use to track when we need to POST Thermostat changes to the Resideo API
    this.doThermostatUpdate = new Subject()
    this.thermostatUpdateInProgress = false

    // Initialize Thermostat Service
    accessory.context.Thermostat = accessory.context.Thermostat ?? {}
    this.Thermostat = {
      Name: accessory.context.Thermostat.Name ?? `${accessory.displayName} Thermostat`,
      Service: accessory.getService(this.hap.Service.Thermostat) ?? this.accessory.addService(this.hap.Service.Thermostat) as Service,
      TargetTemperature: accessory.context.TargetTemperature ?? 20,
      CurrentTemperature: accessory.context.CurrentTemperature ?? 20,
      TemperatureDisplayUnits: accessory.context.TemperatureDisplayUnits,
      TargetHeatingCoolingState: accessory.context.TargetHeatingCoolingState ?? this.hap.Characteristic.TargetHeatingCoolingState.AUTO,
      CurrentHeatingCoolingState: accessory.context.CurrentHeatingCoolingState ?? this.hap.Characteristic.CurrentHeatingCoolingState.OFF,
      CoolingThresholdTemperature: accessory.context.CoolingThresholdTemperature ?? 20,
      HeatingThresholdTemperature: accessory.context.HeatingThresholdTemperature ?? 22,
    }
    accessory.context.Thermostat = this.Thermostat as object

    // Service Name
    this.Thermostat.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Thermostat.Name)
      .setCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.Thermostat.CurrentHeatingCoolingState)
      .getCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits)
      .onGet(() => {
        this.Thermostat.TemperatureDisplayUnits = device.units === 'Celsius'
          ? this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS
          : this.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
        accessory.context.TemperatureDisplayUnits = this.Thermostat.TemperatureDisplayUnits
        this.debugLog(`${this.device.deviceClass} ${accessory.displayName} TemperatureDisplayUnits: ${this.Thermostat.TemperatureDisplayUnits}`)
        return this.Thermostat.TemperatureDisplayUnits
      })
      .onSet(this.setTemperatureDisplayUnits.bind(this))

    // Set Min and Max
    if (device.minHeatSetpoint && device.maxHeatSetpoint) {
      this.debugLog(`${this.device.deviceClass} ${accessory.displayName} minHeatSetpoint: ${device.minHeatSetpoint}, maxHeatSetpoint: ${device.maxHeatSetpoint}, TemperatureDisplayUnits: ${this.Thermostat.TemperatureDisplayUnits}`)
      const minValue = toCelsius(device.minHeatSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
      const maxValue = toCelsius(device.maxHeatSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${this.device.deviceClass} ${accessory.displayName} minValue: ${minValue}, maxValue: ${maxValue}`)
      if (device.changeableValues!.heatCoolMode === 'Heat') {
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${this.device.deviceClass} ${accessory.displayName} mode: ${device.changeableValues!.heatCoolMode}`)
        this.Thermostat.Service
          .getCharacteristic(this.hap.Characteristic.TargetTemperature)
          .setProps({
            minValue,
            maxValue,
            minStep: 0.5,
          })
          .onGet(() => {
            return this.Thermostat.TargetTemperature
          })
      } else {
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${this.device.deviceClass} ${accessory.displayName} mode: ${device.changeableValues!.heatCoolMode}`)
        this.Thermostat.Service
          .getCharacteristic(this.hap.Characteristic.TargetTemperature)
          .setProps({
            minValue,
            maxValue,
            minStep: 0.5,
          })
          .onGet(() => {
            return this.Thermostat.TargetTemperature
          })
      }
    }

    // The value property of TargetHeaterCoolerState must be one of the following:
    // AUTO = 3; HEAT = 1; COOL = 2; OFF = 0;
    // Set control bindings
    const TargetState = [4]
    TargetState.pop()
    if (this.device.allowedModes?.includes('Cool')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.COOL)
    }
    if (this.device.allowedModes?.includes('Heat')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.HEAT)
    }
    if (this.device.allowedModes?.includes('Off')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.OFF)
    }
    if (this.device.allowedModes?.includes('Auto') || this.device.thermostat?.show_auto) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.AUTO)
    }
    this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} allowedModes: ${this.device.allowedModes}`)
    this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} Only Show These Modes: ${JSON.stringify(TargetState)}`)

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: TargetState,
      })
      .onGet(() => {
        return this.Thermostat.TargetHeatingCoolingState
      })
      .onSet(this.setTargetHeatingCoolingState.bind(this))

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature)
      .onGet(() => {
        return this.Thermostat.HeatingThresholdTemperature
      })
      .onSet(this.setHeatingThresholdTemperature.bind(this))

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature)
      .onGet(() => {
        return this.Thermostat.CoolingThresholdTemperature
      })
      .onSet(this.setCoolingThresholdTemperature.bind(this))

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.TargetTemperature)
      .onGet(() => {
        return this.Thermostat.TargetTemperature
      })
      .onSet(this.setTargetTemperature.bind(this))

    // Initialize Humidity Sensor Service
    if (device.thermostat?.hide_humidity) {
      if (this.HumiditySensor) {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Removing Humidity Sensor Service`)
        this.HumiditySensor.Service = this.accessory.getService(this.hap.Service.HumiditySensor) as Service
        accessory.removeService(this.HumiditySensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Humidity Sensor Service Not Found`)
      }
    } else if (device.indoorHumidity) {
      this.debugLog(`Thermostat: ${accessory.displayName} Add Humidity Sensor Service`)
      accessory.context.HumiditySensor = accessory.context.HumiditySensor ?? {}
      this.HumiditySensor = {
        Name: accessory.context.HumiditySensor.Name ?? `${accessory.displayName} Humidity Sensor`,
        Service: accessory.getService(this.hap.Service.HumiditySensor) ?? accessory.addService(this.hap.Service.HumiditySensor) as Service,
        CurrentRelativeHumidity: accessory.context.CurrentRelativeHumidity ?? 50,
      }
      accessory.context.HumiditySensor = this.HumiditySensor as object

      // Initialize Humidity Sensor Characteristic
      this.HumiditySensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.HumiditySensor.Name)

      this.HumiditySensor.Service
        .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
        .setProps({
          minStep: 0.1,
        })
        .onGet(() => {
          return this.HumiditySensor!.CurrentRelativeHumidity
        })
    } else {
      this.debugLog(`Thermostat: ${accessory.displayName} Humidity Sensor Service Not Added`)
    }
    // Initial Refresh
    this.refreshStatus()

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics()

    // Start an update interval
    interval(this.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.thermostatUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
        await this.refreshSensorStatus()
      })

    // Watch for thermostat change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    if (device.thermostat?.roompriority?.deviceType === 'Thermostat') {
      this.doRoomUpdate
        .pipe(
          tap(() => {
            this.roomUpdateInProgress = true
          }),
          debounceTime(this.devicePushRate * 500),
        )
        .subscribe(async () => {
          try {
            await this.refreshRoomPriority()
          } catch (e: any) {
            const action = 'refreshRoomPriority'
            if (this.device.retry) {
              // Refresh the status from the API
              interval(5000)
                .pipe(skipWhile(() => this.thermostatUpdateInProgress))
                .pipe(take(1))
                .subscribe(async () => {
                  await this.refreshRoomPriority()
                })
            }
            this.resideoAPIError(e, action)
            this.apiError(e)
          }
          try {
            await this.pushRoomChanges()
          } catch (e: any) {
            const action = 'pushRoomChanges'
            if (this.device.retry) {
              // Refresh the status from the API
              interval(5000)
                .pipe(skipWhile(() => this.thermostatUpdateInProgress))
                .pipe(take(1))
                .subscribe(async () => {
                  await this.pushRoomChanges()
                })
            }
            this.resideoAPIError(e, action)
            this.apiError(e)
          }
          this.roomUpdateInProgress = false
          // Refresh the status from the API
          interval(5000)
            .pipe(skipWhile(() => this.thermostatUpdateInProgress))
            .pipe(take(1))
            .subscribe(async () => {
              await this.refreshStatus()
            })
        })
    }
    this.doThermostatUpdate
      .pipe(
        tap(() => {
          this.thermostatUpdateInProgress = true
        }),
        debounceTime(this.devicePushRate * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges()
        } catch (e: any) {
          const action = 'pushChanges'
          if (this.device.retry) {
            // Refresh the status from the API
            interval(5000)
              .pipe(skipWhile(() => this.thermostatUpdateInProgress))
              .pipe(take(1))
              .subscribe(async () => {
                await this.pushChanges()
              })
          }
          this.resideoAPIError(e, action)
          this.apiError(e)
        }
        this.thermostatUpdateInProgress = false
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus()
          })
      })
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    // Parse the device status
    if (this.device.units === 'Fahrenheit') {
      this.Thermostat.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
    }
    if (this.device.units === 'Celsius') {
      this.Thermostat.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS
    }

    // Parse the Sensor Accessory status
    if (this.sensorAccessory) {
      const accessoryValue = this.sensorAccessory.accessoryValue as accessoryValue
        ?? { indoorTemperature: 20, indoorHumidity: 50 }

      this.Thermostat.CurrentTemperature = toCelsius(accessoryValue.indoorTemperature, Number(this.Thermostat.TemperatureDisplayUnits))
      this.debugLog(`${this.sensorAccessory.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CurrentTemperature: ${this.Thermostat.CurrentTemperature}`)

      if (!this.device.thermostat?.hide_humidity && accessoryValue.indoorHumidity) {
        if (this.HumiditySensor) {
          this.HumiditySensor!.CurrentRelativeHumidity = accessoryValue.indoorHumidity
          this.debugLog(`${this.sensorAccessory.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor.CurrentRelativeHumidity}`)
        }
      }
    }

    // Parse the Thermostat status
    if (this.device.changeableValues!.heatSetpoint > 0) {
      this.Thermostat.HeatingThresholdTemperature = toCelsius(this.device.changeableValues!.heatSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
    }

    if (this.device.changeableValues!.coolSetpoint > 0) {
      this.Thermostat.CoolingThresholdTemperature = toCelsius(this.device.changeableValues!.coolSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
    }

    this.Thermostat.TargetHeatingCoolingState = HomeKitModes[this.device.changeableValues!.mode]

    /**
     * The CurrentHeatingCoolingState is either 'Heat', 'Cool', or 'Off'
     * CurrentHeatingCoolingState =  OFF = 0, HEAT = 1, COOL = 2
     */
    switch (this.device.operationStatus!.mode) {
      case 'Heat':
        this.Thermostat.CurrentHeatingCoolingState = this.hap.Characteristic.CurrentHeatingCoolingState.HEAT // 1
        break
      case 'Cool':
        this.Thermostat.CurrentHeatingCoolingState = this.hap.Characteristic.CurrentHeatingCoolingState.COOL // 2
        break
      default:
        this.Thermostat.CurrentHeatingCoolingState = this.hap.Characteristic.CurrentHeatingCoolingState.OFF // 0
    }
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CurrentHeatingCoolingState: ${this.Thermostat.CurrentHeatingCoolingState}`)

    // Set the TargetTemperature value based on the current mode
    if (this.Thermostat.TargetHeatingCoolingState === this.hap.Characteristic.TargetHeatingCoolingState.HEAT) {
      if (this.device.changeableValues!.heatSetpoint > 0) {
        this.Thermostat.TargetTemperature = toCelsius(this.device.changeableValues!.heatSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
      }
    } else {
      if (this.device.changeableValues!.coolSetpoint > 0) {
        this.Thermostat.TargetTemperature = toCelsius(this.device.changeableValues!.coolSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
      }
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const device: any = (
        await this.platform.axios.get(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
          params: {
            locationId: this.location.locationID,
          },
        })
      ).data
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${device.deviceClass} ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(device)}`)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${device.deviceClass} ${this.accessory.displayName} Fetched update for: ${this.device.name} from Resideo API: ${JSON.stringify(this.device.changeableValues)}`)
      this.device = device
      this.parseStatus()
      this.updateHomeKitCharacteristics()
    } catch (e: any) {
      const action = 'refreshStatus'
      if (this.device.retry) {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus()
          })
      }
      this.resideoAPIError(e, action)
      this.apiError(e)
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshSensorStatus(): Promise<void> {
    try {
      if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
        if (typeof this.device.deviceID === 'string' && this.device.deviceID.startsWith('LCC')) {
          if (this.device.deviceModel.startsWith('T9')) {
            if (this.device.groups) {
              const groups = this.device.groups
              for (const group of groups) {
                const roomsensors = await this.platform.getCurrentSensorData(this.location, this.device, group)
                if (roomsensors.rooms) {
                  const rooms = roomsensors.rooms
                  this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} roomsensors: ${JSON.stringify(roomsensors)}`)
                  for (const accessories of rooms) {
                    if (accessories) {
                      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} accessories: ${JSON.stringify(accessories)}`)
                      for (const sensorAccessory of accessories.accessories) {
                        if (sensorAccessory.accessoryAttribute) {
                          if (sensorAccessory.accessoryAttribute.type) {
                            if (sensorAccessory.accessoryAttribute.type.startsWith('IndoorAirSensor')) {
                              this.sensorAccessory = sensorAccessory
                              this.parseStatus()
                              this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} accessoryAttribute: ${JSON.stringify(this.sensorAccessory?.accessoryAttribute)}`)
                              this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Name: ${this.sensorAccessory?.accessoryAttribute.name}, Software Version: ${this.sensorAccessory?.accessoryAttribute.softwareRevision}`)
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      this.updateHomeKitCharacteristics()
    } catch (e: any) {
      const action = 'refreshSensorStatus'
      if (this.device.retry) {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshSensorStatus()
          })
      }
      this.resideoAPIError(e, action)
      this.apiError(e)
    }
  }

  async refreshRoomPriority(): Promise<void> {
    if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
      try {
        const roomPriorityStatus = (
          await this.platform.axios.get(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
            params: {
              locationId: this.location.locationID,
            },
          })
        ).data
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} (refreshRoomPriority) roomPriorityStatus: ${JSON.stringify(roomPriorityStatus)}`)
      } catch (e: any) {
        const action = 'refreshRoomPriority'
        if (this.device.retry) {
          // Refresh the status from the API
          interval(5000)
            .pipe(skipWhile(() => this.thermostatUpdateInProgress))
            .pipe(take(1))
            .subscribe(async () => {
              await this.refreshRoomPriority()
            })
        }
        this.resideoAPIError(e, action)
        this.apiError(e)
      }
    }
    this.parseStatus()
    this.updateHomeKitCharacteristics()
  }

  /**
   * Pushes the requested changes for Room Priority to the Resideo API
   */
  async pushRoomChanges(): Promise<void> {
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Room Priority,
     Current Room: ${JSON.stringify(this.roomPriorityStatus.currentPriority.selectedRooms)}, Changing Room: [${this.sensorAccessory?.accessoryId}]`)
    if (`[${this.sensorAccessory?.accessoryId}]` !== `[${this.roomPriorityStatus.currentPriority.selectedRooms}]`) {
      const payload = {
        currentPriority: {
          priorityType: this.device.thermostat?.roompriority?.priorityType,
        },
      } as any

      if (this.device.thermostat?.roompriority?.priorityType === 'PickARoom') {
        payload.currentPriority.selectedRooms = [this.sensorAccessory?.accessoryId]
      }

      /**
       * For "LCC-" devices only.
       * "NoHold" will return to schedule.
       * "TemporaryHold" will hold the set temperature until "nextPeriodTime".
       * "PermanentHold" will hold the setpoint until user requests another change.
       */
      if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
        if (this.device.thermostat?.roompriority.priorityType === 'FollowMe') {
          this.successLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} sent request to Resideo API, Priority Type: ${this.device.thermostat?.roompriority.priorityType} Built-in Occupancy Sensor(s) Will be used to set Priority Automatically.`)
        } else if (this.device.thermostat?.roompriority.priorityType === 'WholeHouse') {
          this.successLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} sent request to Resideo API, Priority Type: ${this.device.thermostat?.roompriority.priorityType}`)
        } else if (this.device.thermostat?.roompriority.priorityType === 'PickARoom') {
          this.successLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} sent request to Resideo API, Room Priority: ${this.sensorAccessory?.accessoryAttribute.name}, Priority Type: ${this.device.thermostat?.roompriority.priorityType}`)
        }

        // Make the API request
        try {
          await this.platform.axios.put(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, payload, {
            params: {
              locationId: this.location.locationID,
            },
          })
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} pushRoomChanges: ${JSON.stringify(payload)}`)
        } catch (e: any) {
          const action = 'pushRoomChanges'
          if (this.device.retry) {
            // Refresh the status from the API
            interval(5000)
              .pipe(skipWhile(() => this.thermostatUpdateInProgress))
              .pipe(take(1))
              .subscribe(async () => {
                await this.pushRoomChanges()
              })
          }
          this.resideoAPIError(e, action)
          this.apiError(e)
        }
      }
      // Refresh the status from the API
      await this.refreshSensorStatus()
    }
  }

  /**
   * Pushes the requested changes to the Resideo API
   */
  async pushChanges(): Promise<void> {
    try {
      const payload = {
        mode: await this.ResideoMode(),
        thermostatSetpointStatus: this.device.thermostat?.thermostatSetpointStatus,
        autoChangeoverActive: this.device.changeableValues!.autoChangeoverActive,
      } as payload

      // Set the heat and cool set point value based on the selected mode
      switch (this.Thermostat.TargetHeatingCoolingState) {
        case this.hap.Characteristic.TargetHeatingCoolingState.HEAT:
          payload.heatSetpoint = toFahrenheit(Number(this.Thermostat.TargetTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          payload.coolSetpoint = toFahrenheit(Number(this.Thermostat.CoolingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TargetHeatingCoolingState (HEAT): ${this.Thermostat.TargetHeatingCoolingState}, TargetTemperature: ${toFahrenheit(Number(this.Thermostat.TargetTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} heatSetpoint, CoolingThresholdTemperature: ${toFahrenheit(Number(this.Thermostat.CoolingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} coolSetpoint`)
          break
        case this.hap.Characteristic.TargetHeatingCoolingState.COOL:
          payload.coolSetpoint = toFahrenheit(Number(this.Thermostat.TargetTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          payload.heatSetpoint = toFahrenheit(Number(this.Thermostat.HeatingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TargetHeatingCoolingState (COOL): ${this.Thermostat.TargetHeatingCoolingState}, TargetTemperature: ${toFahrenheit(Number(this.Thermostat.TargetTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} coolSetpoint, CoolingThresholdTemperature: ${toFahrenheit(Number(this.Thermostat.HeatingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} heatSetpoint`)
          break
        case this.hap.Characteristic.TargetHeatingCoolingState.AUTO:
          payload.coolSetpoint = toFahrenheit(Number(this.Thermostat.CoolingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          payload.heatSetpoint = toFahrenheit(Number(this.Thermostat.HeatingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TargetHeatingCoolingState (AUTO): ${this.Thermostat.TargetHeatingCoolingState}, CoolingThresholdTemperature: ${toFahrenheit(Number(this.Thermostat.CoolingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} coolSetpoint, HeatingThresholdTemperature: ${toFahrenheit(Number(this.Thermostat.HeatingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} heatSetpoint`)
          break
        default:
          payload.coolSetpoint = toFahrenheit(Number(this.Thermostat.CoolingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          payload.heatSetpoint = toFahrenheit(Number(this.Thermostat.HeatingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TargetHeatingCoolingState (OFF): ${this.Thermostat.TargetHeatingCoolingState}, CoolingThresholdTemperature: ${toFahrenheit(Number(this.Thermostat.CoolingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} coolSetpoint, HeatingThresholdTemperature: ${toFahrenheit(Number(this.Thermostat.HeatingThresholdTemperature), Number(this.Thermostat.TemperatureDisplayUnits))} heatSetpoint`)
      }
      this.successLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} set request (${JSON.stringify(payload)}) to Resideo API.`)

      // Make the API request
      await this.platform.axios.post(`${DeviceURL}/thermostats/${this.device.deviceID}`, payload, {
        params: {
          locationId: this.location.locationID,
        },
      })
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`)
    } catch (e: any) {
      const action = 'pushChanges'
      if (this.device.retry) {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.pushChanges()
          })
      }
      this.resideoAPIError(e, action)
      this.apiError(e)
    }
  }

  async ResideoMode() {
    let resideoMode: string
    switch (this.Thermostat.TargetHeatingCoolingState) {
      case this.hap.Characteristic.TargetHeatingCoolingState.HEAT:
        resideoMode = ResideoModes.Heat
        break
      case this.hap.Characteristic.TargetHeatingCoolingState.COOL:
        resideoMode = ResideoModes.Cool
        break
      case this.hap.Characteristic.TargetHeatingCoolingState.AUTO:
        resideoMode = ResideoModes.Auto
        break
      case this.hap.Characteristic.TargetHeatingCoolingState.OFF:
        resideoMode = ResideoModes.Off
        break
      default:
        resideoMode = 'Unknown'
        this.debugErrorLog(`${this.device.deviceClass} ${this.accessory.displayName} Unknown TargetHeatingCoolingState: ${this.Thermostat.TargetHeatingCoolingState}`)
    }
    return resideoMode
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.Thermostat.TemperatureDisplayUnits === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TemperatureDisplayUnits: ${this.Thermostat.TemperatureDisplayUnits}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.Thermostat.TemperatureDisplayUnits)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic TemperatureDisplayUnits: ${this.Thermostat.TemperatureDisplayUnits}`)
    }
    if (this.Thermostat.CurrentTemperature === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CurrentTemperature: ${this.Thermostat.CurrentTemperature}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.Thermostat.CurrentTemperature)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.Thermostat.CurrentTemperature}`)
    }
    if (this.HumiditySensor?.CurrentRelativeHumidity === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor?.CurrentRelativeHumidity}`)
    } else {
      this.HumiditySensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.HumiditySensor.CurrentRelativeHumidity)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic CurrentRelativeHumidity: ${this.HumiditySensor.CurrentRelativeHumidity}`)
    }
    if (this.Thermostat.TargetTemperature === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TargetTemperature: ${this.Thermostat.TargetTemperature}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.Thermostat.TargetTemperature)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic TargetTemperature: ${this.Thermostat.TargetTemperature}`)
    }
    if (this.Thermostat.HeatingThresholdTemperature === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} HeatingThresholdTemperature: ${this.Thermostat.HeatingThresholdTemperature}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, this.Thermostat.HeatingThresholdTemperature)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic HeatingThresholdTemperature: ${this.Thermostat.HeatingThresholdTemperature}`)
    }
    if (this.Thermostat.CoolingThresholdTemperature === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CoolingThresholdTemperature: ${this.Thermostat.CoolingThresholdTemperature}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, this.Thermostat.CoolingThresholdTemperature)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic CoolingThresholdTemperature: ${this.Thermostat.CoolingThresholdTemperature}`)
    }
    if (this.Thermostat.TargetHeatingCoolingState === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} TargetHeatingCoolingState: ${this.Thermostat.TargetHeatingCoolingState}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, this.Thermostat.TargetHeatingCoolingState)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic TargetHeatingCoolingState: ${this.Thermostat.TargetHeatingCoolingState}`)
    }
    if (this.Thermostat.CurrentHeatingCoolingState === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} CurrentHeatingCoolingState: ${this.Thermostat.CurrentHeatingCoolingState}`)
    } else {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.Thermostat.CurrentHeatingCoolingState)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic CurrentHeatingCoolingState: ${this.Thermostat.TargetHeatingCoolingState}`)
    }
  }

  async apiError(e: any): Promise<void> {
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, e)
    // throw new this.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Set TargetHeatingCoolingState: ${value}`)

    this.Thermostat.TargetHeatingCoolingState = value

    // Set the TargetTemperature value based on the selected mode
    if (this.Thermostat.TargetHeatingCoolingState === this.hap.Characteristic.TargetHeatingCoolingState.HEAT) {
      this.Thermostat.TargetTemperature = toCelsius(this.device.changeableValues!.heatSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
    } else {
      this.Thermostat.TargetTemperature = toCelsius(this.device.changeableValues!.coolSetpoint, Number(this.Thermostat.TemperatureDisplayUnits))
    }
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.Thermostat.TargetTemperature)
    if (this.Thermostat.TargetHeatingCoolingState !== HomeKitModes[this.device.changeableValues!.mode]) {
      this.doRoomUpdate.next()
      this.doThermostatUpdate.next()
    }
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Set HeatingThresholdTemperature: ${value}`)
    this.Thermostat.HeatingThresholdTemperature = value
    this.doThermostatUpdate.next()
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Set CoolingThresholdTemperature: ${value}`)
    this.Thermostat.CoolingThresholdTemperature = value
    this.doThermostatUpdate.next()
  }

  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Set TargetTemperature: ${value}`)
    this.Thermostat.TargetTemperature = value
    this.doThermostatUpdate.next()
  }

  async setTemperatureDisplayUnits(value: CharacteristicValue): Promise<void> {
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.device.deviceClass} ${this.accessory.displayName} Set TemperatureDisplayUnits: ${value}`)
    this.warnLog('Changing the Hardware Display Units from HomeKit is not supported.')

    this.Thermostat.TemperatureDisplayUnits = this.device.units === 'Celsius'
      ? this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS
      : this.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT

    // change the temp units back to the one the Resideo API said the thermostat was set to
    setTimeout(() => {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.Thermostat.TemperatureDisplayUnits)
    }, 100)
  }
}
