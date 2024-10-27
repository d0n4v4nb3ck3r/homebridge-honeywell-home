/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * roomsensors.ts: homebridge-resideo.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { ResideoPlatform } from '../platform.js'
import type { accessoryValue, devicesConfig, location, resideoDevice, sensorAccessory, T9groups } from '../settings.js'

import { interval, Subject } from 'rxjs'
import { skipWhile, take } from 'rxjs/operators'

import { toCelsius } from '../utils.js'
import { deviceBase } from './device.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RoomSensors extends deviceBase {
  // Services
  private Battery: {
    Name: CharacteristicValue
    Service: Service
    BatteryLevel: CharacteristicValue
    ChargingState: CharacteristicValue
    StatusLowBattery: CharacteristicValue
  }

  private OccupancySensor?: {
    Name: CharacteristicValue
    Service: Service
    OccupancyDetected: CharacteristicValue
  }

  private HumiditySensor?: {
    Name: CharacteristicValue
    Service: Service
    CurrentRelativeHumidity: CharacteristicValue
  }

  private TemperatureSensor?: {
    Name: CharacteristicValue
    Service: Service
    CurrentTemperature: CharacteristicValue
  }

  TemperatureDisplayUnits!: CharacteristicValue

  // Others
  accessoryId!: number
  roomId!: number

  // Updates
  SensorUpdateInProgress!: boolean
  doSensorUpdate!: Subject<void>

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    location: location,
    device: resideoDevice & devicesConfig,
    sensorAccessory: sensorAccessory,
    readonly group: T9groups,
  ) {
    super(platform, accessory, location, device, sensorAccessory, group)

    this.accessoryId = sensorAccessory.accessoryId
    this.roomId = sensorAccessory.roomId

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doSensorUpdate = new Subject()
    this.SensorUpdateInProgress = false

    // Initialize Battery Service
    accessory.context.Battery = accessory.context.Battery ?? {}
    this.Battery = {
      Name: accessory.context.Battery.Name ?? `${accessory.displayName} Battery`,
      Service: accessory.getService(this.hap.Service.Battery) ?? accessory.addService(this.hap.Service.Battery) as Service,
      BatteryLevel: accessory.context.BatteryLevel ?? 100,
      ChargingState: accessory.context.ChargingState ?? this.hap.Characteristic.ChargingState.NOT_CHARGEABLE,
      StatusLowBattery: accessory.context.StatusLowBattery ?? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    }
    accessory.context.Battery = this.Battery as object
    // set the service name, this is what is displayed as the default name on the Home app
    this.Battery.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Battery.Name)
      .setCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGEABLE)
      .getCharacteristic(this.hap.Characteristic.BatteryLevel)
      .onGet(() => {
        return this.Battery.BatteryLevel
      })

    // Initialize Occupancy Sensor Service
    if (device.thermostat?.roomsensor?.hide_occupancy) {
      if (this.OccupancySensor) {
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${accessory.displayName} Removing Occupancy Sensor Service`)
        this.OccupancySensor.Service = accessory.getService(this.hap.Service.OccupancySensor) as Service
        accessory.removeService(this.OccupancySensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Occupancy Sensor Service Not Found`)
      }
    } else {
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${accessory.displayName} Add Occupancy Sensor Service`)
      accessory.context.OccupancySensor = accessory.context.OccupancySensor ?? {}
      this.OccupancySensor = {
        Name: accessory.context.OccupancySensor.Name ?? `${accessory.displayName} Occupancy Sensor`,
        Service: accessory.getService(this.hap.Service.OccupancySensor) ?? accessory.addService(this.hap.Service.OccupancySensor) as Service,
        OccupancyDetected: accessory.context.OccupancyDetected ?? this.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      }
      accessory.context.OccupancySensor = this.OccupancySensor as object

      // Initialize Occupancy Sensor Characteristic
      this.OccupancySensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.OccupancySensor.Name)
    }

    // Initialize Temperature Sensor Service
    if (device.thermostat?.roomsensor?.hide_temperature) {
      if (this.TemperatureSensor) {
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${accessory.displayName} Removing Temperature Sensor Service`)
        this.TemperatureSensor.Service = accessory.getService(this.hap.Service.TemperatureSensor) as Service
        accessory.removeService(this.TemperatureSensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Temperature Sensor Service Not Found`)
      }
    } else {
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${accessory.displayName} Add Temperature Sensor Service`)
      accessory.context.TemperatureSensor = accessory.context.TemperatureSensor ?? {}
      this.TemperatureSensor = {
        Name: accessory.context.TemperatureSensor.Name ?? `${accessory.displayName} Temperature Sensor`,
        Service: accessory.getService(this.hap.Service.TemperatureSensor) ?? accessory.addService(this.hap.Service.TemperatureSensor) as Service,
        CurrentTemperature: accessory.context.CurrentTemperature ?? 20,
      }
      accessory.context.TemperatureSensor = this.TemperatureSensor as object

      // Initialize Temperature Sensor Characteristic
      this.TemperatureSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.TemperatureSensor.Name)
        .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
        .setProps({
          minValue: -273.15,
          maxValue: 100,
          minStep: 0.1,
        })
        .onGet(async () => {
          return this.TemperatureSensor!.CurrentTemperature
        })
    }

    // Initialize Humidity Sensor Service
    if (device.thermostat?.roomsensor?.hide_humidity) {
      if (this.HumiditySensor) {
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${accessory.displayName} Removing Humidity Sensor Service`)
        this.HumiditySensor.Service = accessory.getService(this.hap.Service.HumiditySensor) as Service
        accessory.removeService(this.HumiditySensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Humidity Sensor Service Not Found`)
      }
    } else {
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} ${accessory.displayName} Add Humidity Sensor Service`)
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
    }

    // Intial Refresh
    this.refreshStatus()

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics()

    // Start an update interval
    interval(this.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    // Get the accessory value
    const accessoryValue = this.sensorAccessory?.accessoryValue as accessoryValue
      ?? { batteryStatus: 'Ok', indoorTemperature: 20, indoorHumidity: 50, occupancyDet: false }

    // Set Room Sensor State
    if (accessoryValue.batteryStatus.startsWith('Ok')) {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    } else {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
    }
    this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`)

    // Set Temperature Sensor State
    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      if (this.TemperatureSensor) {
        this.TemperatureSensor.CurrentTemperature = toCelsius(accessoryValue.indoorTemperature, this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS)
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} CurrentTemperature: ${this.TemperatureSensor.CurrentTemperature}°c`)
      }
    }

    // Set Occupancy Sensor State
    if (!this.device.thermostat?.roomsensor?.hide_occupancy) {
      if (this.OccupancySensor) {
        if (accessoryValue.occupancyDet) {
          this.OccupancySensor.OccupancyDetected = 1
        } else {
          this.OccupancySensor.OccupancyDetected = 0
        }
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} OccupancyDetected: ${this.OccupancySensor.OccupancyDetected}`)
      }
    }

    // Set Humidity Sensor State
    if (!this.device.thermostat?.roomsensor?.hide_humidity) {
      if (this.HumiditySensor) {
        this.HumiditySensor.CurrentRelativeHumidity = accessoryValue.indoorHumidity
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor.CurrentRelativeHumidity}%`)
      }
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const roomsensors = await this.platform.getCurrentSensorData(this.location, this.device, this.group)
      this.sensorAccessory = roomsensors[this.roomId][this.accessoryId]
      this.parseStatus()
      this.updateHomeKitCharacteristics()
    } catch (e: any) {
      const action = 'refreshStatus'
      if (this.device.retry) {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.SensorUpdateInProgress))
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
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.Battery.StatusLowBattery === undefined) {
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`)
    } else {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery)
      this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.Battery.StatusLowBattery}`)
    }

    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      if (Number.isNaN(this.TemperatureSensor?.CurrentTemperature) === false) {
        if (this.TemperatureSensor?.CurrentTemperature === undefined) {
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} CurrentTemperature: ${this.TemperatureSensor?.CurrentTemperature}`)
        } else {
          this.TemperatureSensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.TemperatureSensor.CurrentTemperature)
          this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.TemperatureSensor.CurrentTemperature}`)
        }
      }
    }
    if (!this.device.thermostat?.roomsensor?.hide_occupancy) {
      if (this.OccupancySensor?.OccupancyDetected === undefined) {
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} OccupancyDetected: ${this.OccupancySensor?.OccupancyDetected}`)
      } else {
        this.OccupancySensor.Service.updateCharacteristic(this.hap.Characteristic.OccupancyDetected, this.OccupancySensor.OccupancyDetected)
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} updateCharacteristic OccupancyDetected: ${this.OccupancySensor.OccupancyDetected}`)
      }
    }
    if (this.device.thermostat?.roomsensor?.hide_humidity) {
      if (this.HumiditySensor?.CurrentRelativeHumidity === undefined) {
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor?.CurrentRelativeHumidity}`)
      } else {
        this.HumiditySensor.Service?.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.HumiditySensor.CurrentRelativeHumidity)
        this.debugLog(`${this.sensorAccessory?.accessoryAttribute.type} ${this.accessory.displayName} updateCharacteristic CurrentRelativeHumidity: ${this.HumiditySensor.CurrentRelativeHumidity}`)
      }
    }
  }

  async apiError(e: any): Promise<void> {
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, e)
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, e)
    if (!this.device.thermostat?.roomsensor?.hide_temperature) {
      this.TemperatureSensor?.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e)
    }
    if (!this.device.thermostat?.roomsensor?.hide_occupancy) {
      this.OccupancySensor?.Service.updateCharacteristic(this.hap.Characteristic.OccupancyDetected, e)
    }
    if (this.device.thermostat?.roomsensor?.hide_humidity) {
      this.HumiditySensor?.Service?.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, e)
    }
  }
}
