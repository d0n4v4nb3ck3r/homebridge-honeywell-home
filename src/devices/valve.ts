/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * valve.ts: homebridge-resideo.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { ResideoPlatform } from '../platform.js'
import type { devicesConfig, location, payload, resideoDevice } from '../settings.js'

// import { request } from 'undici';
import { interval, Subject } from 'rxjs'
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators'

import { DeviceURL } from '../settings.js'
import { deviceBase } from './device.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Valve extends deviceBase {
  // Services
  private Valve: {
    Name: CharacteristicValue
    Service: Service
    Active: CharacteristicValue
    InUse: CharacteristicValue
    ValveType: CharacteristicValue
  }

  // Config
  valveType!: number

  // Updates
  valveUpdateInProgress!: boolean
  doValveUpdate!: Subject<void>

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    location: location,
    device: resideoDevice & devicesConfig,
  ) {
    super(platform, accessory, location, device)

    this.getValveConfigSettings(accessory, device)

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doValveUpdate = new Subject()
    this.valveUpdateInProgress = false

    // Initialize Valve property
    accessory.context.Valve = accessory.context.Valve ?? {}
    this.Valve = {
      Name: accessory.context.Valve.Name ?? accessory.displayName,
      Service: accessory.getService(this.hap.Service.Valve) ?? accessory.addService(this.hap.Service.Valve) as Service,
      Active: accessory.context.Active ?? this.hap.Characteristic.Active.INACTIVE,
      InUse: accessory.context.InUse ?? this.hap.Characteristic.InUse.NOT_IN_USE,
      ValveType: accessory.context.ValveType ?? this.hap.Characteristic.ValveType.GENERIC_VALVE,
    }
    accessory.context.Valve = this.Valve as object

    // set the service name, this is what is displayed as the default name on the Home app
    this.Valve.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Valve.Name)
      .setCharacteristic(this.hap.Characteristic.ValveType, this.valveType)
      .getCharacteristic(this.hap.Characteristic.Active)
      .onGet(() => {
        return this.Valve.Active
      })
      .onSet(this.setActive.bind(this))

    // InUse
    this.Valve.Service
      .getCharacteristic(this.hap.Characteristic.InUse)
      .onGet(() => {
        return this.Valve.InUse
      })

    // Intial Refresh
    this.refreshStatus()

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics()

    // Start an update interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.valveUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })

    // Watch for Lock change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doValveUpdate
      .pipe(
        tap(() => {
          this.valveUpdateInProgress = true
        }),
        debounceTime(this.devicePushRate * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges()
        } catch (e: any) {
          const action = 'pushChanges'
          await this.resideoAPIError(e, action)
          this.errorLog(`${device.deviceClass} ${accessory.displayName}: doValveUpdate pushChanges: ${JSON.stringify(e)}`)
        }
        // Refresh the status from the API
        interval(this.deviceRefreshRate * 500)
          .pipe(skipWhile(() => this.valveUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus()
          })
        this.valveUpdateInProgress = false
      })
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(device: resideoDevice & devicesConfig): Promise<void> {
    // Active
    if (device.isAlive) {
      this.Valve.Active = this.hap.Characteristic.Active.ACTIVE
    } else {
      this.Valve.Active = this.hap.Characteristic.Active.INACTIVE
    }
    this.accessory.context.Active = this.Valve.Active

    // InUse
    if (device.actuatorValve.valveStatus === 'Open') {
      this.Valve.InUse = this.hap.Characteristic.InUse.IN_USE
    } else {
      this.Valve.InUse = this.hap.Characteristic.InUse.NOT_IN_USE
    }
    if (this.Valve.InUse !== this.accessory.context.InUse) {
      this.successLog(`${this.device.deviceClass} ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(device)}`)
      this.accessory.context.InUse = this.Valve.InUse
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const device: any = (await this.platform.axios.get(`${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`, {
        params: {
          locationId: this.location.locationID,
        },
      })).data
      /*
      const { body, statusCode } = await request(`${DeviceURL}/shutoffvalve/${this.device.deviceID}`, {
        method: 'GET',
        query: {
          'locationId': this.location.locationID,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const action = 'refreshStatus';
      await this.statusCode(statusCode, action);
      const device: any = await body.json(); */
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(device)}`)
      this.parseStatus(device)
      this.updateHomeKitCharacteristics()
    } catch (e: any) {
      const action = 'refreshStatus'
      if (this.device.retry) {
        if (action === 'refreshStatus') {
          // Refresh the status from the API
          interval(5000)
            .pipe(skipWhile(() => this.valveUpdateInProgress))
            .pipe(take(1))
            .subscribe(async () => {
              await this.refreshStatus()
            })
        }
      }
      await this.resideoAPIError(e, action)
      this.apiError(e)
    }
  }

  /**
   * Pushes the requested changes to the August API
   */
  async pushChanges(): Promise<void> {
    try {
      const payload = {} as payload
      if (this.Valve.Active === this.hap.Characteristic.Active.ACTIVE) {
        payload.state = 'open'
      } else {
        payload.state = 'closed'
      }
      await this.platform.axios.post(`${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`, payload, {
        params: {
          locationId: this.location.locationID,
        },
      })
      /*
      const { statusCode } = await request(`${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        query: {
          'locationId': this.location.locationID,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`);
      if (statusCode === 200) {
        this.successLog(`${this.device.deviceClass}: ${this.accessory.displayName} `
          + `request to Resideo API, state: ${JSON.stringify(payload.state)} sent successfully`);
      } else {
        const action = 'pushChanges';
        await this.statusCode(statusCode, action);
      } */
    } catch (e: any) {
      const action = 'pushChanges'
      await this.resideoAPIError(e, action)
      this.errorLog(`pushChanges: ${JSON.stringify(e)}`)
      this.errorLog(`${this.device.deviceClass} ${this.accessory.displayName} failed pushChanges, Error Message: ${JSON.stringify(e.message)}`)
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.Valve.Active === undefined) {
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} Active: ${this.Valve.Active}`)
    } else {
      this.Valve.Service.updateCharacteristic(this.hap.Characteristic.Active, this.Valve.Active)
      this.accessory.context.Active = this.Valve.Active
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic Active: ${this.Valve.Active}`)
    }
    if (this.Valve.InUse === undefined) {
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} InUse: ${this.Valve.InUse}`)
    } else {
      this.accessory.context.InUse = this.Valve.InUse
      this.Valve.Service.updateCharacteristic(this.hap.Characteristic.InUse, this.Valve.InUse)
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic InUse: ${this.Valve.InUse}`)
    }
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  setActive(value: CharacteristicValue) {
    this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} Set Active: ${value}`)
    this.Valve.Active = value
    this.doValveUpdate.next()
  }

  async getValveConfigSettings(accessory: PlatformAccessory, device: resideoDevice & devicesConfig) {
    switch (device.valve?.valveType) {
      case 1:
        this.valveType = this.hap.Characteristic.ValveType.IRRIGATION
        break
      case 2:
        this.valveType = this.hap.Characteristic.ValveType.SHOWER_HEAD
        break
      case 3:
        this.valveType = this.hap.Characteristic.ValveType.WATER_FAUCET
        break
      default:
        this.valveType = this.hap.Characteristic.ValveType.GENERIC_VALVE
    }
    accessory.context.valveType = this.valveType
  }

  async apiError(e: any): Promise<void> {
    this.Valve.Service.updateCharacteristic(this.hap.Characteristic.Active, e)
  }
}
