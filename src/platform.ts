/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: homebridge-resideo.
 */
import type { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory, UnknownContext } from 'homebridge'

import type {
  accessoryAttribute,
  devicesConfig,
  location,
  locations,
  resideoDevice,
  ResideoPlatformConfig,
  sensorAccessory,
  T9groups,
} from './settings.js'

import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { stringify } from 'node:querystring'

import { request } from 'undici'

import { LeakSensor } from './devices/leaksensors.js'
import { RoomSensors } from './devices/roomsensors.js'
import { RoomSensorThermostat } from './devices/roomsensorthermostats.js'
import { Thermostats } from './devices/thermostats.js'
import { Valve } from './devices/valve.js'
import {
  DeviceURL,
  LocationURL,
  PLATFORM_NAME,
  PLUGIN_NAME,
  TokenURL,
} from './settings.js'

export class ResideoPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory[] = []
  public readonly api: API
  public readonly log: Logging
  protected readonly hap: HAP
  public config!: ResideoPlatformConfig
  public sensorData = []
  refreshInterval: any
  locations?: locations
  sensorAccessory!: sensorAccessory
  firmware!: accessoryAttribute['softwareRevision']
  platformConfig!: ResideoPlatformConfig['options']
  platformLogging!: ResideoPlatformConfig['logging']
  debugMode!: boolean
  version!: string
  action!: string

  constructor(log: Logging, config: ResideoPlatformConfig, api: API) {
    this.api = api
    this.hap = this.api.hap
    this.log = log
    if (!config) {
      return
    }

    this.config = { platform: 'Resideo', credentials: config.credentials, options: config.options }
    this.getPlatformLogSettings()
    this.getPlatformConfigSettings()
    this.getVersion()
    this.debugLog(`Finished initializing platform: ${config.name}`)

    try {
      this.verifyConfig()
      this.debugLog('Config OK')
    } catch (e: any) {
      this.action = 'get Valid Config'
      this.apiError(e)
      return
    }

    this.api.on('didFinishLaunching', async () => {
      this.debugLog('Executed didFinishLaunching callback')
      await this.refreshAccessToken()
      if (this.config.credentials?.accessToken) {
        this.debugLog(`accessToken: ${this.config.credentials?.accessToken}`)
        try {
          this.discoverDevices()
        } catch (e: any) {
          this.action = 'Discover Device'
          this.apiError(e)
        }
      } else {
        this.errorLog('Missing Access Token. Re-Link Your Resideo Account.')
      }
    })
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.debugLog(`Loading accessory from cache: ${accessory.displayName}`)
    this.accessories.push(accessory)
  }

  verifyConfig() {
    this.config.options = this.config.options || {}
    this.config.credentials = this.config.credentials || {}

    if (this.config.options.devices) {
      for (const deviceConfig of this.config.options.devices) {
        if (!deviceConfig.hide_device && !deviceConfig.deviceClass) {
          throw new Error('The devices config section is missing the "Device Type" in the config, Check Your Config.')
        }
        if (!deviceConfig.deviceID) {
          throw new Error('The devices config section is missing the "Device ID" in the config, Check Your Config.')
        }
      }
    }

    if (this.config.options.refreshRate! < 30) {
      throw new Error('Refresh Rate must be above 30 seconds.')
    }

    if (!this.config.options.refreshRate) {
      this.config.options.refreshRate = 120
      this.debugWarnLog('Using Default Refresh Rate of 2 Minutes.')
    }

    if (!this.config.options.pushRate) {
      this.config.options.pushRate = 0.1
      this.debugWarnLog('Using Default Push Rate.')
    }

    if (!this.config.credentials) {
      throw new Error('Missing Credentials')
    }
    if (!this.config.credentials.consumerKey) {
      throw new Error('Missing consumerKey')
    }
    if (!this.config.credentials.refreshToken) {
      throw new Error('Missing refreshToken')
    }
  }

  async refreshAccessToken() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }
    this.refreshInterval = setInterval(async () => this.getAccessToken(), (1800 / 3) * 1000)
    await this.getAccessToken()
  }

  async getAccessToken() {
    try {
      let result: any
      if (this.config.credentials?.consumerSecret) {
        const { body } = await request(TokenURL, {
          method: 'POST',
          body: stringify({
            grant_type: 'refresh_token',
            refresh_token: this.config.credentials!.refreshToken,
          }),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${this.config.credentials?.consumerKey}:${this.config.credentials?.consumerSecret}`).toString('base64')}`,
          },
        })
        result = await body.json()
      } else {
        this.warnLog('Please re-link your account in the Homebridge UI.')
      }

      this.config.credentials!.accessToken = result.access_token
      this.debugLog(`Got access token: ${this.config.credentials!.accessToken}`)
      if (result.refresh_token !== this.config.credentials!.refreshToken) {
        this.debugLog(`New refresh token: ${result.refresh_token}`)
        await this.updateRefreshToken(result.refresh_token)
      }

      this.config.credentials!.refreshToken = result.refresh_token
    } catch (e: any) {
      this.action = 'refresh access token'
      this.apiError(e)
    }
  }

  async updateRefreshToken(newRefreshToken: string) {
    try {
      if (!newRefreshToken) {
        throw new Error('New token not provided')
      }

      const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'))
      if (!Array.isArray(currentConfig.platforms)) {
        throw new TypeError('Cannot find platforms array in config')
      }

      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME)
      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`)
      }

      if (typeof pluginConfig.credentials !== 'object') {
        throw new TypeError('pluginConfig.credentials is not an object')
      }

      pluginConfig.credentials.refreshToken = newRefreshToken
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4))
      this.debugLog('Homebridge config.json has been updated with new refresh token.')
    } catch (e: any) {
      this.action = 'refresh token in config'
      this.apiError(e)
    }
  }

  public async discoverlocations(): Promise<location[]> {
    this.debugLog(`accessToken: ${this.config.credentials?.accessToken}, consumerKey: ${this.config.credentials?.consumerKey}`)
    const { body, statusCode } = await request(LocationURL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
        'Content-Type': 'application/json',
        'apikey': this.config.credentials?.consumerKey,
      },
    })

    this.debugLog(`Response status code: ${statusCode}`)

    if (statusCode !== 200) {
      throw new Error(`Failed to fetch locations: ${statusCode}`)
    }

    const locations = await body.json() as location[]
    this.debugLog(`(discoverlocations) Location: ${JSON.stringify(locations)}`)
    return locations // Ensure this returns an array
  }

  public async getCurrentSensorData(location: location, device: resideoDevice & devicesConfig, group: T9groups) {
    if (!this.sensorData[device.deviceID] || this.sensorData[device.deviceID].timestamp < Date.now()) {
      const { body } = await request(`${DeviceURL}/thermostats/${device.deviceID}/group/${group.id}/rooms`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
          'apikey': this.config.credentials?.consumerKey,
        },
        query: { locationId: location.locationID },
      })
      const response = await body.json()
      this.sensorData[device.deviceID] = {
        timestamp: Date.now() + 45000,
        data: this.normalizeSensorDate((response as { data: any }).data),
      }
      this.debugLog(`getCurrentSensorData ${device.deviceType} ${device.deviceModel}: ${this.sensorData[device.deviceID]}`)
    } else {
      this.debugLog(`getCurrentSensorData Cache ${device.deviceType} ${device.deviceModel} - ${device.userDefinedDeviceName}`)
    }
    return this.sensorData[device.deviceID].data
  }

  private normalizeSensorDate(sensorRoomData: { rooms: any }) {
    const normalized = [] as any
    for (const room of sensorRoomData.rooms) {
      normalized[room.id] = [] as any
      for (const sensorAccessory of room.accessories) {
        sensorAccessory.roomId = room.id
        normalized[room.id][sensorAccessory.accessoryId] = sensorAccessory
      }
    }
    return normalized
  }

  public async getSoftwareRevision(location: location, device: resideoDevice & devicesConfig) {
    if (device.deviceModel.startsWith('T9') && device.groups) {
      for (const group of device.groups) {
        const roomsensors = await this.getCurrentSensorData(location, device, group)
        if (device.thermostat?.roompriority?.deviceType) {
          this.infoLog(`Total Rooms Found: ${roomsensors.length}`)
        }
        for (const accessories of roomsensors) {
          for (const key in accessories) {
            const sensorAccessory = accessories[key]
            if (sensorAccessory.accessoryAttribute?.type?.startsWith('Thermostat')) {
              this.debugLog(`groupId: ${group.id}, roomId: ${sensorAccessory.roomId}, accessoryId: ${sensorAccessory.accessoryId}, name: ${sensorAccessory.accessoryAttribute.name}, softwareRevision: ${sensorAccessory.accessoryAttribute.softwareRevision}`)
              return sensorAccessory.accessoryAttribute.softwareRevision
            }
          }
        }
      }
    }
  }

  private async discoverDevices() {
    try {
      const locations = await this.discoverlocations() as locations ?? []
      this.infoLog(`Total Locations Found: ${locations?.length}`)
      if (locations.length > 0) {
        for (const location of locations) {
          this.infoLog(`Total Devices Found at ${location.name}: ${location.devices.length}`)
          const deviceLists = location.devices
          const devices = this.config.options?.devices
            ? this.mergeByDeviceID(deviceLists.map(device => ({ ...device, deviceID: String(device.deviceID) })), this.config.options.devices)
            : deviceLists.map((v: any) => v)
          for (const device of devices) {
            await this.deviceClass(location, device)
          }
        }
      } else {
        this.debugWarnLog('No locations found.')
      }
    } catch (e: any) {
      this.action = 'Discover Locations'
      this.apiError(e)
    }
  }

  private mergeByDeviceID(a1: { deviceID: string }[], a2: any[]) {
    return a1.map((itm: { deviceID: string }) => ({
      ...a2.find((item: { deviceID: string }) => item.deviceID === itm.deviceID && item),
      ...itm,
    }))
  }

  private async deviceClass(location: location, device: resideoDevice & devicesConfig) {
    switch (device.deviceClass) {
      case 'ShutoffValve':
        this.debugLog(`Discovered ${device.userDefinedDeviceName} ${device.deviceClass} @ ${location.name}`)
        this.createValve(location, device)
        break
      case 'LeakDetector':
        this.debugLog(`Discovered ${device.userDefinedDeviceName} ${device.deviceClass} @ ${location.name}`)
        this.createLeak(location, device)
        break
      case 'Thermostat':
        this.debugLog(`Discovered ${device.userDefinedDeviceName} ${device.deviceClass} (${device.deviceModel}) @ ${location.name}`)
        await this.createThermostat(location, device)
        if (device.deviceModel.startsWith('T9')) {
          try {
            this.debugLog(`Discovering Room Sensor(s) for ${device.userDefinedDeviceName} ${device.deviceClass} (${device.deviceModel})`)
            await this.discoverRoomSensors(location, device)
          } catch (e: any) {
            this.action = 'Find Room Sensor(s)'
            this.apiError(e)
          }
        }
        break
      default:
        this.infoLog(`Device: ${device.userDefinedDeviceName} with Device Class: ${device.deviceClass} is currently not supported. Submit Feature Requests Here: https://git.io/JURLY`)
    }
  }

  private async discoverRoomSensors(location: location, device: resideoDevice & devicesConfig) {
    this.roomsensordisplaymethod(device)
    if (device.groups) {
      this.debugLog(`Discovered ${device.groups.length} Group(s) for ${device.userDefinedDeviceName} ${device.deviceClass} (${device.deviceModel})`)
      for (const group of device.groups) {
        const roomsensors = await this.getCurrentSensorData(location, device, group)
        for (const accessories of roomsensors) {
          for (const key in accessories) {
            const sensorAccessory = accessories[key]
            if (sensorAccessory.accessoryAttribute?.type?.startsWith('IndoorAirSensor')) {
              this.debugLog(`Discovered Room Sensor groupId: ${sensorAccessory.roomId}, roomId: ${sensorAccessory.accessoryId}, accessoryId: ${sensorAccessory.accessoryAttribute.name}`)
              if (sensorAccessory.accessoryAttribute.model === '0') {
                sensorAccessory.accessoryAttribute.model = '4352'
              }
              this.createRoomSensors(location, device, group, sensorAccessory)
              this.createRoomSensorThermostat(location, device, group, sensorAccessory)
            }
          }
        }
      }
    }
  }

  private roomsensordisplaymethod(device: resideoDevice & devicesConfig) {
    if (device.thermostat?.roompriority) {
      if (device.thermostat?.roompriority.deviceType && !device.hide_device) {
        this.warnLog('Displaying Thermostat(s) for Each Room Sensor(s).')
      }
      if (!device.thermostat?.roompriority.deviceType && !device.hide_device) {
        this.warnLog('Only Displaying Room Sensor(s).')
      }
    }
  }

  private async createThermostat(location: location, device: resideoDevice & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(`${device.deviceID}-${device.deviceClass}`)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.deviceID}`)
        existingAccessory.displayName = device.userDefinedDeviceName
        await this.thermostatFirmwareExistingAccessory(device, existingAccessory, location)
        existingAccessory.context.device = device
        existingAccessory.context.deviceID = device.deviceID
        existingAccessory.context.model = device.deviceModel
        this.api.updatePlatformAccessories([existingAccessory])
        new Thermostats(this, existingAccessory, location, device)
        this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${existingAccessory.UUID})`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (await this.registerDevice(device)) {
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${device.userDefinedDeviceName} ${device.deviceClass} Device ID: ${device.deviceID}`)
      }
      const accessory = new this.api.platformAccessory(device.userDefinedDeviceName, uuid)
      await this.thermostatFirmwareNewAccessory(device, accessory, location)
      accessory.context.device = device
      accessory.context.deviceID = device.deviceID
      accessory.context.model = device.deviceModel
      new Thermostats(this, accessory, location, device)
      this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${accessory.UUID})`)
      this.externalOrPlatform(device, accessory)
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.userDefinedDeviceName} ${device.deviceModel} DeviceID: ${device.deviceID}, Check Config to see if DeviceID is being Hidden.`)
    }
  }

  private async createLeak(location: location, device: resideoDevice & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(`${device.deviceID}-${device.deviceClass}`)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.deviceID}`)
        existingAccessory.displayName = device.userDefinedDeviceName
        existingAccessory.context.deviceID = device.deviceID
        existingAccessory.context.model = device.deviceClass
        this.leaksensorFirmwareExistingAccessory(device, existingAccessory)
        this.api.updatePlatformAccessories([existingAccessory])
        new LeakSensor(this, existingAccessory, location, device)
        this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${existingAccessory.UUID})`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (await this.registerDevice(device)) {
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${device.userDefinedDeviceName} ${device.deviceClass} Device ID: ${device.deviceID}`)
      }
      const accessory = new this.api.platformAccessory(device.userDefinedDeviceName, uuid)
      accessory.context.device = device
      accessory.context.deviceID = device.deviceID
      accessory.context.model = device.deviceClass
      this.leaksensorFirmwareNewAccessory(device, accessory)
      new LeakSensor(this, accessory, location, device)
      this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${accessory.UUID})`)
      this.externalOrPlatform(device, accessory)
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.userDefinedDeviceName} ${device.deviceType} DeviceID: ${device.deviceID}, Check Config to see if DeviceID is being Hidden.`)
    }
  }

  private async createValve(location: location, device: resideoDevice & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(`${device.deviceID}-${device.deviceClass}`)

    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.deviceID}`)
        existingAccessory.displayName = device.userDefinedDeviceName
        existingAccessory.context.deviceID = device.deviceID
        existingAccessory.context.model = device.deviceClass
        this.valveFirmwareExistingAccessory(device, existingAccessory)
        this.api.updatePlatformAccessories([existingAccessory])
        new Valve(this, existingAccessory, location, device)
        this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${existingAccessory.UUID})`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (await this.registerDevice(device)) {
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${device.userDefinedDeviceName} ${device.deviceClass} Device ID: ${device.deviceID}`)
      }
      const accessory = new this.api.platformAccessory(device.userDefinedDeviceName, uuid)
      accessory.context.device = device
      accessory.context.deviceID = device.deviceID
      accessory.context.model = device.deviceClass
      this.valveFirmwareNewAccessory(device, accessory)
      new Valve(this, accessory, location, device)
      this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${accessory.UUID})`)
      this.externalOrPlatform(device, accessory)
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.userDefinedDeviceName} ${device.deviceType} DeviceID: ${device.deviceID}, Check Config to see if DeviceID is being Hidden.`)
    }
  }

  private async createRoomSensors(location: location, device: resideoDevice & devicesConfig, group: T9groups, sensorAccessory: sensorAccessory) {
    const uuid = this.api.hap.uuid.generate(`${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryAttribute.serialNumber}-RoomSensor`)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}`)
        existingAccessory.displayName = sensorAccessory.accessoryAttribute.name
        existingAccessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber
        existingAccessory.context.model = sensorAccessory.accessoryAttribute.model
        this.roomsensorFirmwareExistingAccessory(existingAccessory, sensorAccessory)
        this.api.updatePlatformAccessories([existingAccessory])
        new RoomSensors(this, existingAccessory, location, device, sensorAccessory, group)
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} uuid: ${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensor, (${existingAccessory.UUID})`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (await this.registerDevice(device)) {
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} Device ID: ${sensorAccessory.accessoryAttribute.serialNumber}`)
      }
      const accessory = new this.api.platformAccessory(sensorAccessory.accessoryAttribute.name, uuid)
      accessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber
      accessory.context.model = sensorAccessory.accessoryAttribute.model
      this.roomsensorFirmwareNewAccessory(accessory, sensorAccessory)
      new RoomSensors(this, accessory, location, device, sensorAccessory, group)
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} uuid: ${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensor, (${accessory.UUID})`)
      this.externalOrPlatform(device, accessory)
      this.accessories.push(accessory)
    } else {
      this.errorLog(`Unable to Register new device: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}, Check Config to see if DeviceID is being Hidden.`)
    }
  }

  private async createRoomSensorThermostat(location: location, device: resideoDevice & devicesConfig, group: T9groups, sensorAccessory: sensorAccessory) {
    const uuid = this.api.hap.uuid.generate(`${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat`)
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}`)
        existingAccessory.displayName = sensorAccessory.accessoryAttribute.name
        existingAccessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber
        existingAccessory.context.model = sensorAccessory.accessoryAttribute.model
        this.roomsensorFirmwareExistingAccessory(existingAccessory, sensorAccessory)
        this.api.updatePlatformAccessories([existingAccessory])
        new RoomSensorThermostat(this, existingAccessory, location, device, sensorAccessory, group)
        this.debugLog(`${sensorAccessory.accessoryAttribute.type} Thermostat uuid: ${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat, (${existingAccessory.UUID})`)
      } else {
        this.unregisterPlatformAccessories(existingAccessory)
      }
    } else if (await this.registerDevice(device)) {
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}`)
      }
      const accessory = new this.api.platformAccessory(sensorAccessory.accessoryAttribute.name, uuid)
      accessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber
      accessory.context.model = sensorAccessory.accessoryAttribute.model
      this.roomsensorFirmwareNewAccessory(accessory, sensorAccessory)
      new RoomSensorThermostat(this, accessory, location, device, sensorAccessory, group)
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} Thermostat uuid: ${sensorAccessory.accessoryAttribute.name}-${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat, (${accessory.UUID})`)
      this.externalOrPlatform(device, accessory)
      this.accessories.push(accessory)
    } else {
      this.debugErrorLog(`Unable to Register new device: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}, Check Config to see if DeviceID is being Hidden.`)
    }
  }

  async registerDevice(device: resideoDevice & devicesConfig) {
    let registerDevice: boolean
    this.debugLog(`Device: ${device.userDefinedDeviceName} hide_roomsensor: ${device.thermostat?.roomsensor?.hide_roomsensor}, roompriority: ${device.thermostat?.roompriority?.deviceType}, hide_device: ${device.hide_device}`)
    if (!device.thermostat?.roomsensor?.hide_roomsensor) {
      registerDevice = true
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`)
    } else if (device.thermostat?.roompriority?.deviceType) {
      registerDevice = true
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`)
    } else if (!device.hide_device) {
      registerDevice = true
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`)
    } else {
      registerDevice = false
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`)
    }
    if (registerDevice === true) {
      this.debugWarnLog(`Device: ${device.userDefinedDeviceName} will display in HomeKit`)
    } else {
      this.debugErrorLog(`Device: ${device.userDefinedDeviceName} will not display in HomeKit`)
    }
    return registerDevice
  }

  private leaksensorFirmwareNewAccessory(device: resideoDevice & devicesConfig, accessory: PlatformAccessory) {
    if (device.firmware) {
      accessory.context.firmwareRevision = device.firmware
    } else {
      accessory.context.firmwareRevision = this.version
    }
  }

  private leaksensorFirmwareExistingAccessory(device: resideoDevice & devicesConfig, existingAccessory: PlatformAccessory) {
    if (device.firmware) {
      existingAccessory.context.firmwareRevision = device.firmware
    } else {
      existingAccessory.context.firmwareRevision = this.version
    }
  }

  private valveFirmwareNewAccessory(device: resideoDevice & devicesConfig, accessory: PlatformAccessory) {
    if (device.firmware) {
      accessory.context.firmwareRevision = device.firmware
    } else {
      accessory.context.firmwareRevision = this.version
    }
  }

  private valveFirmwareExistingAccessory(device: resideoDevice & devicesConfig, existingAccessory: PlatformAccessory) {
    if (device.firmware) {
      existingAccessory.context.firmwareRevision = device.firmware
    } else {
      existingAccessory.context.firmwareRevision = this.version
    }
  }

  private roomsensorFirmwareNewAccessory(accessory: PlatformAccessory, sensorAccessory: sensorAccessory) {
    if (accessory.context.firmware) {
      accessory.context.firmwareRevision = accessory.context.firmware
    } else {
      accessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision ?? this.version
    }
  }

  private roomsensorFirmwareExistingAccessory(existingAccessory: PlatformAccessory, sensorAccessory: sensorAccessory) {
    if (existingAccessory.context.firmware) {
      existingAccessory.context.firmwareRevision = existingAccessory.context.firmware
    } else {
      existingAccessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision || this.version
    }
  }

  public async thermostatFirmwareNewAccessory(device: resideoDevice & devicesConfig, accessory: PlatformAccessory, location: any) {
    if (device.firmware) {
      accessory.context.firmwareRevision = device.firmware
    } else {
      if (device.deviceModel.startsWith('T9')) {
        try {
          accessory.context.firmwareRevision = await this.getSoftwareRevision(location.locationID, device)
        } catch (e: any) {
          this.action = 'Get T9 Firmware Version'
          this.apiError(e)
        }
      } else if (device.deviceModel.startsWith('Round') || device.deviceModel.startsWith('Unknown') || device.deviceModel.startsWith('D6')) {
        accessory.context.firmwareRevision = device.thermostatVersion
      } else {
        accessory.context.firmwareRevision = this.version
      }
    }
  }

  public async thermostatFirmwareExistingAccessory(device: resideoDevice & devicesConfig, existingAccessory: PlatformAccessory, location: any) {
    if (device.firmware) {
      existingAccessory.context.firmwareRevision = device.firmware
    } else {
      if (device.deviceModel.startsWith('T9')) {
        try {
          existingAccessory.context.firmwareRevision = await this.getSoftwareRevision(location.locationID, device)
        } catch (e: any) {
          this.action = 'Get T9 Firmware Version'
          this.apiError(e)
        }
      } else if (device.deviceModel.startsWith('Round') || device.deviceModel.startsWith('Unknown') || device.deviceModel.startsWith('D6')) {
        existingAccessory.context.firmwareRevision = device.thermostatVersion
      } else {
        existingAccessory.context.firmwareRevision = this.version
      }
    }
  }

  public async externalOrPlatform(device: resideoDevice & devicesConfig, accessory: PlatformAccessory) {
    if (device.external) {
      this.warnLog(`${accessory.displayName} External Accessory Mode`)
      this.externalAccessory(accessory)
    } else {
      this.debugLog(`${accessory.displayName} External Accessory Mode: ${device.external}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    }
  }

  public async externalAccessory(accessory: PlatformAccessory) {
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory])
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory])
    this.warnLog(`Removing existing accessory from cache: ${existingAccessory.displayName}`)
  }

  apiError(e: any) {
    if (e.message.includes('400')) {
      this.errorLog(`Failed to ${this.action}: Bad Request`)
      this.debugLog('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.')
    } else if (e.message.includes('401')) {
      this.errorLog(`Failed to ${this.action}: Unauthorized Request`)
      this.debugLog('Authorization for the API is required, but the request has not been authenticated.')
    } else if (e.message.includes('403')) {
      this.errorLog(`Failed to ${this.action}: Forbidden Request`)
      this.debugLog('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.')
    } else if (e.message.includes('404')) {
      this.errorLog(`Failed to ${this.action}: Request Not Found`)
      this.debugLog('Specifies the requested path does not exist.')
    } else if (e.message.includes('406')) {
      this.errorLog(`Failed to ${this.action}: Request Not Acceptable`)
      this.debugLog('The client has requested a MIME type via the Accept header for a value not supported by the server.')
    } else if (e.message.includes('415')) {
      this.errorLog(`Failed to ${this.action}: Unsupported Request Header`)
      this.debugLog('The client has defined a contentType header that is not supported by the server.')
    } else if (e.message.includes('422')) {
      this.errorLog(`Failed to ${this.action}: Unprocessable Entity`)
      this.debugLog('The client has made a valid request, but the server cannot process it. This is often used for APIs for which certain limits have been exceeded.')
    } else if (e.message.includes('429')) {
      this.errorLog(`Failed to ${this.action}: Too Many Requests`)
      this.debugLog('The client has exceeded the number of requests allowed for a given time window.')
    } else if (e.message.includes('500')) {
      this.errorLog(`Failed to ${this.action}: Internal Server Error`)
      this.debugLog('An unexpected error on the SmartThings servers has occurred. These errors should be rare.')
    } else {
      this.errorLog(`Failed to ${this.action}`)
    }
    this.debugErrorLog(`Failed to ${this.action}, Error Message: ${JSON.stringify(e.message)}`)
  }

  async statusCode(statusCode: number, action: string): Promise<void> {
    switch (statusCode) {
      case 200:
        this.debugLog(`Standard Response, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 400:
        this.errorLog(`Bad Request, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 401:
        this.errorLog(`Unauthorized, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 404:
        this.errorLog(`Not Found, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 429:
        this.errorLog(`Too Many Requests, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 500:
        this.errorLog(`Internal Server Error (Meater Server), statusCode: ${statusCode}, Action: ${action}`)
        break
      default:
        this.infoLog(`Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-resideo-bug-report. Action: ${action}`)
    }
  }

  async getPlatformConfigSettings() {
    const platformConfig: ResideoPlatformConfig['options'] = {}
    if (this.config.options) {
      if (this.config.options.logging) {
        platformConfig.logging = this.config.options.logging
      }
      if (this.config.options.refreshRate) {
        platformConfig.refreshRate = this.config.options.refreshRate
      }
      if (this.config.options.pushRate) {
        platformConfig.pushRate = this.config.options.pushRate
      }
      if (Object.entries(platformConfig).length !== 0) {
        this.debugLog(`Platform Config: ${JSON.stringify(platformConfig)}`)
      }
      this.platformConfig = platformConfig
    }
  }

  async getPlatformLogSettings() {
    this.debugMode = process.argv.includes('-D') ?? process.argv.includes('--debug')
    if (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard' || this.config.options?.logging === 'none') {
      this.platformLogging = this.config.options.logging
      await this.debugWarnLog(`Using Config Logging: ${this.platformLogging}`)
    } else if (this.debugMode) {
      this.platformLogging = 'debugMode'
      await this.debugWarnLog(`Using ${this.platformLogging} Logging`)
    } else {
      this.platformLogging = 'standard'
      await this.debugWarnLog(`Using ${this.platformLogging} Logging`)
    }
  }

  public async makeRequest(url: string, options: any): Promise<any> {
    const { body, statusCode } = await request(url, options)
    const data = await body.json()
    return { data, statusCode }
  }

  async getVersion() {
    const json = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
    this.debugLog(`Plugin Version: ${json.version}`)
    this.version = json.version
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.info(String(...log))
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.success(String(...log))
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.success('[DEBUG]', String(...log))
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.warn(String(...log))
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log))
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.error(String(...log))
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log))
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log))
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log))
      }
    }
  }

  async enablingPlatformLogging(): Promise<boolean> {
    return this.platformLogging.includes('debug') ?? this.platformLogging === 'standard'
  }
}
