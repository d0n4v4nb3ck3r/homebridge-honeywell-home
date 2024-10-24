import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import type { ResideoPlatform } from '../platform.js'
import type { devicesConfig, location, payload, resideoDevice } from '../settings.js'

import { interval, Subject } from 'rxjs'
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators'

import { DeviceURL } from '../settings.js'
import { deviceBase } from './device.js'

export class Valve extends deviceBase {
  private Valve: {
    Name: CharacteristicValue
    Service: Service
    Active: CharacteristicValue
    InUse: CharacteristicValue
    ValveType: CharacteristicValue
  }

  valveType!: number
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

    this.doValveUpdate = new Subject()
    this.valveUpdateInProgress = false

    accessory.context.Valve = accessory.context.Valve ?? {}
    this.Valve = {
      Name: accessory.context.Valve.Name ?? accessory.displayName,
      Service: accessory.getService(this.hap.Service.Valve) ?? accessory.addService(this.hap.Service.Valve) as Service,
      Active: accessory.context.Active ?? this.hap.Characteristic.Active.INACTIVE,
      InUse: accessory.context.InUse ?? this.hap.Characteristic.InUse.NOT_IN_USE,
      ValveType: accessory.context.ValveType ?? this.hap.Characteristic.ValveType.GENERIC_VALVE,
    }
    accessory.context.Valve = this.Valve as object

    this.Valve.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Valve.Name)
      .setCharacteristic(this.hap.Characteristic.ValveType, this.valveType)
      .getCharacteristic(this.hap.Characteristic.Active)
      .onGet(() => this.Valve.Active)
      .onSet(this.setActive.bind(this))

    this.Valve.Service
      .getCharacteristic(this.hap.Characteristic.InUse)
      .onGet(() => this.Valve.InUse)

    this.refreshStatus()
    this.updateHomeKitCharacteristics()

    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.valveUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })

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
        interval(this.deviceRefreshRate * 500)
          .pipe(skipWhile(() => this.valveUpdateInProgress), take(1))
          .subscribe(async () => {
            await this.refreshStatus()
          })
        this.valveUpdateInProgress = false
      })
  }

  async parseStatus(device: resideoDevice & devicesConfig): Promise<void> {
    this.Valve.Active = device.isAlive ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE
    this.accessory.context.Active = this.Valve.Active

    this.Valve.InUse = device.actuatorValve.valveStatus === 'Open' ? this.hap.Characteristic.InUse.IN_USE : this.hap.Characteristic.InUse.NOT_IN_USE
    if (this.Valve.InUse !== this.accessory.context.InUse) {
      this.successLog(`${this.device.deviceClass} ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(device)}`)
      this.accessory.context.InUse = this.Valve.InUse
    }
  }

  async refreshStatus(): Promise<void> {
    try {
      const response = await this.platform.makeRequest(
        `${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`,
        {
          method: 'GET',
          query: {
            locationId: this.location.locationID,
          },
          headers: {
            'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const device = await response.json()
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(device)}`)
      this.parseStatus(device as resideoDevice & devicesConfig)
      this.updateHomeKitCharacteristics()
    } catch (e: any) {
      const action = 'refreshStatus'
      if (this.device.retry) {
        if (action === 'refreshStatus') {
          interval(5000)
            .pipe(skipWhile(() => this.valveUpdateInProgress), take(1))
            .subscribe(async () => {
              await this.refreshStatus()
            })
        }
      }
      await this.resideoAPIError(e, action)
      this.apiError(e)
    }
  }

  async pushChanges(): Promise<void> {
    try {
      const payload: payload = {
        state: this.Valve.Active === this.hap.Characteristic.Active.ACTIVE ? 'open' : 'closed',
      }
      const response = await this.platform.makeRequest(
        `${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
          query: {
            locationId: this.location.locationID,
          },
          headers: {
            'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`)
      if (response.statusCode === 200) {
        this.successLog(`${this.device.deviceClass}: ${this.accessory.displayName} request to Resideo API, state: ${JSON.stringify(payload.state)} sent successfully`)
      } else {
        const action = 'pushChanges'
        await this.statusCode(response.statusCode, action)
      }
    } catch (e: any) {
      const action = 'pushChanges'
      await this.resideoAPIError(e, action)
      this.errorLog(`pushChanges: ${JSON.stringify(e)}`)
      this.errorLog(`${this.device.deviceClass} ${this.accessory.displayName} failed pushChanges, Error Message: ${JSON.stringify(e.message)}`)
    }
  }

  async updateHomeKitCharacteristics(): Promise<void> {
    this.Valve.Service.updateCharacteristic(this.hap.Characteristic.Active, this.Valve.Active)
    this.accessory.context.Active = this.Valve.Active
    this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic Active: ${this.Valve.Active}`)

    this.Valve.Service.updateCharacteristic(this.hap.Characteristic.InUse, this.Valve.InUse)
    this.accessory.context.InUse = this.Valve.InUse
    this.debugLog(`${this.device.deviceClass} ${this.accessory.displayName} updateCharacteristic InUse: ${this.Valve.InUse}`)
  }

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
