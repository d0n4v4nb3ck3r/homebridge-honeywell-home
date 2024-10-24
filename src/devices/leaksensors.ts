/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * leaksensors.ts: homebridge-resideo.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { ResideoPlatform } from '../platform.js'
import type { CurrentSensorReadings, devicesConfig, location, resideoDevice } from '../settings.js'

import { interval, Subject } from 'rxjs'
import { skipWhile, take } from 'rxjs/operators'

import { DeviceURL } from '../settings.js'
// import { request } from 'undici';
import { deviceBase } from './device.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LeakSensor extends deviceBase {
  // Services
  private Battery: {
    Name: CharacteristicValue
    Service: Service
    BatteryLevel: CharacteristicValue
    ChargingState: CharacteristicValue
    StatusLowBattery: CharacteristicValue
  }

  private LeakSensor?: {
    Name: CharacteristicValue
    Service: Service
    StatusActive: CharacteristicValue
    LeakDetected: CharacteristicValue
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

  // Updates
  SensorUpdateInProgress!: boolean
  doSensorUpdate!: Subject<void>

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    location: location,
    device: resideoDevice & devicesConfig,
  ) {
    super(platform, accessory, location, device)

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

    // Initialize Leak Sensor Service
    if (device.leaksensor?.hide_leak) {
      if (this.LeakSensor) {
        this.debugLog(`${device.deviceClass} ${accessory.displayName} Removing Leak Sensor Service`)
        this.LeakSensor.Service = accessory.getService(this.hap.Service.LeakSensor) as Service
        accessory.removeService(this.LeakSensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Leak Sensor Service Not Found`)
      }
    } else {
      this.debugLog(`${device.deviceClass} ${accessory.displayName} Add Leak Sensor Service`)
      accessory.context.LeakSensor = accessory.context.LeakSensor ?? {}
      this.LeakSensor = {
        Name: accessory.context.LeakSensor.Name ?? `${accessory.displayName} Leak Sensor`,
        Service: accessory.getService(this.hap.Service.LeakSensor) ?? accessory.addService(this.hap.Service.LeakSensor) as Service,
        StatusActive: accessory.context.StatusActive ?? false,
        LeakDetected: accessory.context.LeakDetected ?? this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      }
      accessory.context.LeakSensor = this.LeakSensor as object

      // Initialize Leak Sensor Characteristic
      this.LeakSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.LeakSensor.Name)
        .getCharacteristic(this.hap.Characteristic.StatusActive)
        .onGet(() => {
          return this.LeakSensor!.StatusActive
        })

      this.LeakSensor.Service
        .getCharacteristic(this.hap.Characteristic.LeakDetected)
        .onGet(() => {
          return this.LeakSensor!.LeakDetected
        })
    }

    // Initialize Temperature Sensor Service
    if (device.leaksensor?.hide_temperature) {
      if (this.TemperatureSensor) {
        this.debugLog(`${device.deviceClass} ${accessory.displayName} Removing Temperature Sensor Service`)
        this.TemperatureSensor.Service = accessory.getService(this.hap.Service.TemperatureSensor) as Service
        accessory.removeService(this.TemperatureSensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Temperature Sensor Service Not Found`)
      }
    } else {
      this.debugLog(`${device.deviceClass} ${accessory.displayName} Add Temperature Sensor Service`)
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
    if (device.leaksensor?.hide_humidity) {
      if (this.HumiditySensor) {
        this.debugLog(`${device.deviceClass} ${accessory.displayName} Removing Humidity Sensor Service`)
        this.HumiditySensor.Service = accessory.getService(this.hap.Service.HumiditySensor) as Service
        accessory.removeService(this.HumiditySensor.Service)
      } else {
        this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Humidity Sensor Service Not Found`)
      }
    } else if (device.indoorHumidity) {
      this.debugLog(`${device.deviceClass} ${accessory.displayName} Add Humidity Sensor Service`)
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
      this.debugLog(`${device.deviceClass} ${accessory.displayName} Humidity Sensor Service Not Added`)
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
  async parseStatus(device: resideoDevice & devicesConfig): Promise<void> {
    // Battery Service
    this.Battery.BatteryLevel = Number(device.batteryRemaining)
    this.Battery.Service.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.Battery.BatteryLevel)
    if (this.device.batteryRemaining < 15) {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
    } else {
      this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    }
    this.debugLog(`${device.deviceClass} ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel}, StatusLowBattery: ${this.Battery.StatusLowBattery}`)

    // LeakSensor Service
    if (!device.leaksensor?.hide_leak) {
      if (this.LeakSensor) {
        // Active
        this.LeakSensor.StatusActive = device.hasDeviceCheckedIn

        // LeakDetected
        if (device.waterPresent === true) {
          this.LeakSensor.LeakDetected = this.hap.Characteristic.LeakDetected.LEAK_DETECTED
        } else {
          this.LeakSensor.LeakDetected = this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED
        }
        this.debugLog(`${device.deviceClass} ${this.accessory.displayName} StatusActive: ${this.LeakSensor.StatusActive}, LeakDetected: ${this.LeakSensor.LeakDetected}`)
      }
    }

    const currentSensorReadings = device.currentSensorReadings as CurrentSensorReadings ?? { temperature: 20, humidity: 50 }

    // Temperature Service
    if (!device.leaksensor?.hide_temperature) {
      if (this.TemperatureSensor) {
        this.TemperatureSensor.CurrentTemperature = currentSensorReadings.temperature
        this.debugLog(`${device.deviceClass} ${this.accessory.displayName} CurrentTemperature: ${this.TemperatureSensor.CurrentTemperature}°`)
      }
    }

    // Humidity Service
    if (!device.leaksensor?.hide_humidity) {
      if (this.HumiditySensor) {
        this.HumiditySensor.CurrentRelativeHumidity = currentSensorReadings.humidity
        this.debugLog(`${device.deviceClass} ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor.CurrentRelativeHumidity}%`)
      }
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const device: any = await this.platform.makeRequest(
        `${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`,
        {
          method: 'GET',
          params: {
            locationId: this.location.locationID,
          },
        },
      )
      this.debugLog(`(refreshStatus) ${device.deviceClass} device: ${JSON.stringify(device)}`)
      await this.parseStatus(device)
      await this.updateHomeKitCharacteristics()
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
    if (this.Battery.BatteryLevel === undefined) {
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} BatteryLevel: ${this.Battery.BatteryLevel}`)
    } else {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel)
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic BatteryLevel: ${this.Battery.BatteryLevel}`)
    }
    if (this.Battery.StatusLowBattery === undefined) {
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} StatusLowBattery: ${this.Battery.StatusLowBattery}`)
    } else {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery)
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.Battery.StatusLowBattery}`)
    }
    if (!this.device.leaksensor?.hide_leak) {
      if (this.LeakSensor?.LeakDetected === undefined) {
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} LeakDetected: ${this.LeakSensor?.LeakDetected}`)
      } else {
        this.LeakSensor?.Service.updateCharacteristic(this.hap.Characteristic.LeakDetected, this.LeakSensor?.LeakDetected)
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic LeakDetected: ${this.LeakSensor?.LeakDetected}`)
      }
      if (this.LeakSensor?.StatusActive === undefined) {
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} StatusActive: ${this.LeakSensor?.StatusActive}`)
      } else {
        this.LeakSensor.Service.updateCharacteristic(this.hap.Characteristic.StatusActive, this.LeakSensor?.StatusActive)
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic StatusActive: ${this.LeakSensor?.StatusActive}`)
      }
    }
    if (!this.device.leaksensor?.hide_temperature) {
      if (this.TemperatureSensor?.CurrentTemperature === undefined) {
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} CurrentTemperature: ${this.TemperatureSensor?.CurrentTemperature}`)
      } else {
        this.TemperatureSensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.TemperatureSensor?.CurrentTemperature)
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.TemperatureSensor!.CurrentTemperature}`)
      }
    }
    if (!this.device.leaksensor?.hide_humidity) {
      if (this.HumiditySensor?.CurrentRelativeHumidity === undefined) {
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} CurrentRelativeHumidity: ${this.HumiditySensor?.CurrentRelativeHumidity}`)
      } else {
        this.HumiditySensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.HumiditySensor?.CurrentRelativeHumidity)
        this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic CurrentRelativeHumidity: ${this.HumiditySensor?.CurrentRelativeHumidity}`)
      }
    }
  }

  async apiError(e: any): Promise<void> {
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, e)
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, e)
    if (!this.device.leaksensor?.hide_leak) {
      this.LeakSensor?.Service.updateCharacteristic(this.hap.Characteristic.LeakDetected, e)
      this.LeakSensor?.Service.updateCharacteristic(this.hap.Characteristic.StatusActive, e)
    }
    if (!this.device.leaksensor?.hide_temperature) {
      this.TemperatureSensor?.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e)
    }
    if (!this.device.leaksensor?.hide_humidity) {
      this.HumiditySensor?.Service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, e)
    }
  }
}
