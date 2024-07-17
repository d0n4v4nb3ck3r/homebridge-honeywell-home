/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * platform.ts: homebridge-resideo.
 */
import type { InternalAxiosRequestConfig, AxiosInstance } from 'axios';
import axios from 'axios';

import type {
  ResideoPlatformConfig,
  T9groups,
  accessoryAttribute,
  devicesConfig,
  location,
  locations,
  resideoDevice,
  sensorAccessory,
} from './settings.js';
import {
  DeviceURL,
  LocationURL,
  PLATFORM_NAME,
  PLUGIN_NAME,
  TokenURL,
} from './settings.js';
import { readFile } from 'fs/promises';
//import { request } from 'undici';
import { readFileSync, writeFileSync } from 'fs';
import type { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory } from 'homebridge';
import { stringify } from 'querystring';
import { Valve } from './devices/valve.js';
import { LeakSensor } from './devices/leaksensors.js';
import { RoomSensors } from './devices/roomsensors.js';
import { Thermostats } from './devices/thermostats.js';
import { RoomSensorThermostat } from './devices/roomsensorthermostats.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ResideoPlatform implements DynamicPlatformPlugin {
  public accessories: PlatformAccessory[];
  public readonly api: API;
  public readonly log: Logging;
  protected readonly hap: HAP;
  public config!: ResideoPlatformConfig;

  public axios: AxiosInstance = axios.create({
    responseType: 'json',
  });

  // Resideo API
  public sensorData = [];
  private refreshInterval!: NodeJS.Timeout;
  locations?: locations;
  sensorAccessory!: sensorAccessory;
  firmware!: accessoryAttribute['softwareRevision'];

  platformConfig!: ResideoPlatformConfig['options'];
  platformLogging!: ResideoPlatformConfig['logging'];
  debugMode!: boolean;
  version!: string;
  action!: string;

  constructor(
    log: Logging,
    config: ResideoPlatformConfig,
    api: API,
  ) {
    this.accessories = [];
    this.api = api;
    this.hap = this.api.hap;
    this.log = log;
    // only load if configured
    if (!config) {
      return;
    }

    // Plugin options into our config variables.
    this.config = {
      platform: 'Resideo',
      credentials: config.credentials,
      options: config.options,
    };
    this.getPlatformLogSettings();
    this.getPlatformConfigSettings();
    this.getVersion();
    this.debugLog(`Finished initializing platform: ${config.name}`);

    // verify the config
    try {
      this.verifyConfig();
      this.debugLog('Config OK');
    } catch (e: any) {
      this.action = 'get Valid Config';
      this.apiError(e);
      return;
    }
    // setup axios interceptor to add headers / api key to each request
    this.axios.interceptors.request.use((request: InternalAxiosRequestConfig) => {
      request.headers!.Authorization = `Bearer ${this.config.credentials?.accessToken}`;
      request.params = request.params || {};
      request.params.apikey = this.config.credentials?.consumerKey;
      request.headers!['Content-Type'] = 'application/json';
      return request;
    });

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      this.debugLog('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      await this.refreshAccessToken();
      if (this.config.credentials?.accessToken) {
        this.debugLog(`accessToken: ${this.config.credentials?.accessToken}`);
        try {
          this.locations = await this.discoverlocations();
        } catch (e: any) {
          this.action = 'Discover Locations';
          this.apiError(e);
        }
        if (this.locations !== undefined) {
          try {
            this.discoverDevices();
          } catch (e: any) {
            this.action = 'Discover Device';
            this.apiError(e);
          }
        } else {
          this.errorLog('Failed to Discover Locations. Re-Link Your Resideo Account.');
        }
      } else {
        this.errorLog('Missing Access Token. Re-Link Your Resideo Account.');
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.debugLog(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  verifyConfig() {
    this.config.options = this.config.options || {};
    this.config.credentials = this.config.credentials || {};

    if (this.config.options) {
      // Device Config
      if (this.config.options.devices) {
        for (const deviceConfig of this.config.options.devices) {
          if (!deviceConfig.hide_device && !deviceConfig.deviceClass) {
            throw new Error('The devices config section is missing the "Device Type" in the config, Check Your Conifg.');
          }
          if (!deviceConfig.deviceID) {
            throw new Error('The devices config section is missing the "Device ID" in the config, Check Your Conifg.');
          }
        }
      }
    }

    if (this.config.options.refreshRate! < 30) {
      throw new Error('Refresh Rate must be above 30 seconds.');
    }

    if (!this.config.options.refreshRate) {
      // default 120 seconds (2 minutes)
      this.config.options.refreshRate = 120;
      this.debugWarnLog('Using Default Refresh Rate of 2 Minutes.');
    }

    if (!this.config.options.pushRate) {
      // default 100 milliseconds
      this.config.options.pushRate = 0.1;
      this.debugWarnLog('Using Default Push Rate.');
    }

    if (!this.config.credentials) {
      throw new Error('Missing Credentials');
    }
    if (!this.config.credentials.consumerKey) {
      throw new Error('Missing consumerKey');
    }
    if (!this.config.credentials.refreshToken) {
      throw new Error('Missing refreshToken');
    }
  }

  async refreshAccessToken() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => this.getAccessToken(), (1800 / 3) * 1000);
    await this.getAccessToken();
  }

  /**
   * Exchange the refresh token for an access token
   */
  async getAccessToken() {
    try {
      let result: any;
      if (this.config.credentials?.consumerSecret) {
        result = (await axios({
          url: TokenURL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: this.config.credentials?.consumerKey ?? '',
            password: this.config.credentials?.consumerSecret ?? '',
          },
          data: stringify({
            grant_type: 'refresh_token',
            refresh_token: this.config.credentials!.refreshToken,
          }),
          responseType: 'json',
        })
        ).data;
      } else {
        this.warnLog('Please re-link your account in the Homebridge UI.');
      }

      this.config.credentials!.accessToken = result.access_token;
      this.debugLog(`Got access token: ${this.config.credentials!.accessToken}`);
      // check if the refresh token has changed
      if (result.refresh_token !== this.config.credentials!.refreshToken) {
        this.debugLog(`New refresh token: ${result.refresh_token}`);
        await this.updateRefreshToken(result.refresh_token);
      }

      this.config.credentials!.refreshToken = result.refresh_token;
      /*
        if (this.config.credentials!.consumerSecret && this.config.credentials!.consumerKey && this.config.credentials!.refreshToken) {
          this.debugLog(`consumerKey: ${this.config.credentials!.consumerKey},` + ` consumerSecret: ${this.config.credentials!.consumerSecret},`
            + ` refreshToken: ${this.config.credentials!.refreshToken}` + ` accessToken: ${this.config.credentials!.accessToken}`);
          const { body, statusCode } = await request(TokenURL, {
            method: 'POST',
            headers: {
              Authorization:
                `Basic ${Buffer.from(`${this.config.credentials!.consumerKey}:${this.config.credentials!.consumerSecret}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: stringify({
              grant_type: 'refresh_token',
              refresh_token: this.config.credentials!.refreshToken,
            }),
          });
          const action = 'getAccessToken';
          await this.statusCode(statusCode, action);
          const result: any = await body.json();
          this.debugLog(`(getAccessToken) Result: ${JSON.stringify(result)}`);
          this.config.credentials!.accessToken = result.access_token;
          this.debugLog(`Got access token: ${this.config.credentials!.accessToken}`);
          // check if the refresh token has changed
          if (result.refresh_token !== this.config.credentials!.refreshToken) {
            this.debugLog(`New refresh token: ${result.refresh_token}`);
            await this.updateRefreshToken(result.refresh_token);
          }
          this.config.credentials!.refreshToken = result.refresh_token;
        } else {
          this.warnLog('Please re-link your account in the Homebridge UI.');
        }*/
    } catch (e: any) {
      this.action = 'refresh access token';
      this.apiError(e);
    }
  }

  /**
   * The refresh token will periodically change.
   * This method saves the updated refresh token in the config.json file
   * @param newRefreshToken
   */
  async updateRefreshToken(newRefreshToken: string) {
    try {
      // check the new token was provided
      if (!newRefreshToken) {
        throw new Error('New token not provided');
      }

      // load in the current config
      const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));

      // check the platforms section is an array before we do array things on it
      if (!Array.isArray(currentConfig.platforms)) {
        throw new Error('Cannot find platforms array in config');
      }

      // find this plugins current config
      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
      }

      // check the .credentials is an object before doing object things with it
      if (typeof pluginConfig.credentials !== 'object') {
        throw new Error('pluginConfig.credentials is not an object');
      }

      // set the refresh token
      pluginConfig.credentials.refreshToken = newRefreshToken;

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));
      this.debugLog('Homebridge config.json has been updated with new refresh token.');
    } catch (e: any) {
      this.action = 'refresh token in config';
      this.apiError(e);
    }
  }

  /**
   * this method discovers the Locations
   */
  async discoverlocations() {
    this.debugLog(`accessToken: ${this.config.credentials?.accessToken}, consumerKey: ${this.config.credentials?.consumerKey}`);
    const locations = (await this.axios.get(LocationURL)).data;
    /*
    const { body, statusCode } = await request(LocationURL, {
      method: 'GET',
      query: {
        'apikey': this.config.credentials?.consumerKey,
      },
      headers: {
        'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    const action = 'discoverlocations';
    await this.statusCode(statusCode, action);
    const locations: any = await body.json();*/
    this.debugLog(`(discoverlocations) Location: ${JSON.stringify(locations)}`);
    return locations;
  }

  /**
   * this method discovers the rooms at each location
   */
  public async getCurrentSensorData(
    location: location,
    device: resideoDevice & devicesConfig,
    group: T9groups,
  ) {
    if (!this.sensorData[device.deviceID] || this.sensorData[device.deviceID].timestamp < Date.now()) {
      const response: any = await this.axios.get(`${DeviceURL}/thermostats/${device.deviceID}/group/${group.id}/rooms`, {
        params: {
          locationId: location.locationID,
        },
      });
      /*
      const { body, statusCode } = await request(`${DeviceURL}/thermostats/${device.deviceID}/group/${group.id}/rooms`, {
        method: 'GET',
        query: {
          'locationId': location.locationID,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const action = 'getCurrentSensorData';
      await this.statusCode(statusCode, action);
      const response: any = await body.json();
      this.debugLog(`(getCurrentSensorData) Response: ${JSON.stringify(response)}`);
*/
      this.sensorData[device.deviceID] = {
        timestamp: Date.now() + 45000,
        data: this.normalizeSensorDate(response.data),
      };
      this.debugLog(`getCurrentSensorData ${device.deviceType} ${device.deviceModel}: ${this.sensorData[device.deviceID]}`);
    } else {
      this.debugLog(`getCurrentSensorData Cache ${device.deviceType} ${device.deviceModel} - ${device.userDefinedDeviceName}`);
    }
    return this.sensorData[device.deviceID].data;
  }

  private normalizeSensorDate(sensorRoomData: { rooms: any }) {
    const normalized = [] as any;
    for (const room of sensorRoomData.rooms) {
      normalized[room.id] = [] as any;
      for (const sensorAccessory of room.accessories) {
        sensorAccessory.roomId = room.id;
        normalized[room.id][sensorAccessory.accessoryId] = sensorAccessory;
      }
    }
    return normalized;
  }

  /**
   * this method discovers the firmware Veriosn for T9 Thermostats
   */
  public async getSoftwareRevision(location: location, device: resideoDevice & devicesConfig) {
    if (device.deviceModel.startsWith('T9') && device.groups) {
      for (const group of device.groups) {
        const roomsensors = await this.getCurrentSensorData(location, device, group);
        if (device.thermostat?.roompriority?.deviceType) {
          if (roomsensors.length !== 0) {
            this.infoLog(`Total Rooms Found: ${roomsensors.length}`);
          } else {
            this.debugLog(`Total Rooms Found: ${roomsensors.length}`);
          }
        }
        for (const accessories of roomsensors) {
          if (accessories) {
            for (const key in accessories) {
              const sensorAccessory = accessories[key];
              this.debugLog(`sensorAccessory: ${JSON.stringify(sensorAccessory)}`);
              if (
                sensorAccessory.accessoryAttribute &&
                sensorAccessory.accessoryAttribute.type &&
                sensorAccessory.accessoryAttribute.type.startsWith('Thermostat')
              ) {
                this.debugLog(`groupId: ${group.id}, roomId: ${sensorAccessory.roomId}, accessoryId: ${sensorAccessory.accessoryId}, name: `
                  + `${sensorAccessory.accessoryAttribute.name}, softwareRevision: ${sensorAccessory.accessoryAttribute.softwareRevision}`);
                return sensorAccessory.accessoryAttribute.softwareRevision;
              } else {
                this.debugLog(`No Thermostat ${device} ${group} ${location.locationID}`);
              }
            }
          } else {
            this.debugLog(`No accessories ${device} ${group} ${location.locationID}`);
          }
        }
      }
    } else {
      this.debugLog(`Not a T9 Thermostat ${device.deviceModel.startsWith('T9')} ${device.groups}`);
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  private async discoverDevices() {
    if (this.locations) {
      if (this.locations.length !== 0) {
        this.infoLog(`Total Locations Found: ${this.locations.length}`);
      } else {
        this.debugLog(`Total Locations Found: ${this.locations.length}`);
      }
      // get the devices at each location
      for (const location of this.locations) {
        if (location.devices.length !== 0) {
          this.infoLog(`Total Devices Found at ${location.name}: ${location.devices.length}`);
        } else {
          this.debugLog(`Total Devices Found at ${location.name}: ${location.devices.length}`);
        }
        const locationId = location.locationID;
        this.debugLog(`Location ID: ${locationId}`);
        const deviceLists = location.devices;
        if (!this.config.options?.devices) {
          this.debugLog(`No Resideo Device Config: ${JSON.stringify(this.config.options?.devices)}`);
          const devices = deviceLists.map((v: any) => v);
          for (const device of devices) {
            await this.deviceClass(location, device);
          }
        } else {
          this.debugLog(`Resideo Device Config Set: ${JSON.stringify(this.config.options?.devices)}`);
          const deviceConfigs = this.config.options?.devices;

          const mergeBydeviceID = (a1: { deviceID: string }[], a2: any[]) =>
            a1.map((itm: { deviceID: string }) => ({
              ...a2.find((item: { deviceID: string }) => item.deviceID === itm.deviceID && item),
              ...itm,
            }));

          const devices = mergeBydeviceID(deviceLists, deviceConfigs);
          this.debugLog(`Resideo Devices: ${JSON.stringify(devices)}`);
          for (const device of devices) {
            await this.deviceClass(location, device);
          }
        }
      }
    } else {
      this.errorLog('Failed to Discover Locations. Re-Link Your Resideo Account.');
    }
  }

  private async deviceClass(location: location, device: resideoDevice & devicesConfig) {
    switch (device.deviceClass) {
      case 'ShutoffValve':
        this.debugLog(`Discovered ${device.userDefinedDeviceName} ${device.deviceClass} @ ${location.name}`);
        this.createValve(location, device);
        break;
      case 'LeakDetector':
        this.debugLog(`Discovered ${device.userDefinedDeviceName} ${device.deviceClass} @ ${location.name}`);
        this.createLeak(location, device);
        break;
      case 'Thermostat':
        this.debugLog(`Discovered ${device.userDefinedDeviceName} ${device.deviceClass} (${device.deviceModel}) @ ${location.name}`);
        await this.createThermostat(location, device);
        if (device.deviceModel.startsWith('T9')) {
          try {
            this.debugLog(`Discovering Room Sensor(s) for ${device.userDefinedDeviceName} ${device.deviceClass} (${device.deviceModel})`);
            await this.discoverRoomSensors(location, device);
          } catch (e: any) {
            this.action = 'Find Room Sensor(s)';
            this.apiError(e);
          }
        }
        break;
      default:
        this.infoLog(`Device: ${device.userDefinedDeviceName} with Device Class: `
          + `${device.deviceClass} is currently not supported. Submit Feature Requests Here: https://git.io/JURLY`);
    }
  }

  private async discoverRoomSensors(location: location, device: resideoDevice & devicesConfig) {
    // get the devices at each location
    this.roomsensordisplaymethod(device);
    if (device.groups) {
      this.debugLog(`Discovered ${device.groups.length} Group(s) for ${device.userDefinedDeviceName} ${device.deviceClass} (${device.deviceModel})`);
      for (const group of device.groups) {
        const roomsensors = await this.getCurrentSensorData(location, device, group);
        for (const accessories of roomsensors) {
          if (accessories) {
            for (const key in accessories) {
              const sensorAccessory = accessories[key];
              if (sensorAccessory.accessoryAttribute) {
                if (sensorAccessory.accessoryAttribute.type) {
                  if (sensorAccessory.accessoryAttribute.type.startsWith('IndoorAirSensor')) {
                    this.debugLog(
                      `Discovered Room Sensor groupId: ${sensorAccessory.roomId},` +
                      ` roomId: ${sensorAccessory.accessoryId}, accessoryId: ${sensorAccessory.accessoryAttribute.name}`,
                    );
                    if (sensorAccessory.accessoryAttribute.model === '0') {
                      sensorAccessory.accessoryAttribute.model = '4352';
                    }
                    this.createRoomSensors(location, device, group, sensorAccessory);
                    this.createRoomSensorThermostat(location, device, group, sensorAccessory);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private roomsensordisplaymethod(device: resideoDevice & devicesConfig) {
    if (device.thermostat?.roompriority) {
      /**
       * Room Priority
       * This will display what room priority option that has been selected.
       */
      if (device.thermostat?.roompriority.deviceType && !device.hide_device) {
        this.warnLog('Displaying Thermostat(s) for Each Room Sensor(s).');
      }
      if (!device.thermostat?.roompriority.deviceType && !device.hide_device) {
        this.warnLog('Only Displaying Room Sensor(s).');
      }
    }
  }

  private async createThermostat(
    location: location,
    device: resideoDevice & devicesConfig,
  ) {
    const uuid = this.api.hap.uuid.generate(`${device.deviceID}-${device.deviceClass}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.deviceID}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = device.userDefinedDeviceName;
        await this.thermostatFirmwareExistingAccessory(device, existingAccessory, location);
        existingAccessory.context.device = device;
        existingAccessory.context.deviceID = device.deviceID;
        existingAccessory.context.model = device.deviceModel;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new Thermostats(this, existingAccessory, location, device);
        this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${existingAccessory.UUID})`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${device.userDefinedDeviceName} ${device.deviceClass} Device ID: ${device.deviceID}`);
      }
      // create a new accessory
      const accessory = new this.api.platformAccessory(device.userDefinedDeviceName, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      await this.thermostatFirmwareNewAccessory(device, accessory, location);
      accessory.context.device = device;
      accessory.context.deviceID = device.deviceID;
      accessory.context.model = device.deviceModel;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new Thermostats(this, accessory, location, device);
      this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.userDefinedDeviceName} ${device.deviceModel} DeviceID: `
        + `${device.deviceID}, Check Config to see if DeviceID is being Hidden.`);
    }
  }

  private async createLeak(location: location, device: resideoDevice & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(`${device.deviceID}-${device.deviceClass}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.deviceID}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = device.userDefinedDeviceName;
        existingAccessory.context.deviceID = device.deviceID;
        existingAccessory.context.model = device.deviceClass;
        this.leaksensorFirmwareExistingAccessory(device, existingAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new LeakSensor(this, existingAccessory, location, device);
        this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${existingAccessory.UUID})`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${device.userDefinedDeviceName} ${device.deviceClass} Device ID: ${device.deviceID}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.userDefinedDeviceName, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.deviceID = device.deviceID;
      accessory.context.model = device.deviceClass;
      this.leaksensorFirmwareNewAccessory(device, accessory);

      // accessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
      // create the accessory handler for the newly create accessory
      // this is imported from `/Sensors/leakSensors.ts`
      new LeakSensor(this, accessory, location, device);
      this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.userDefinedDeviceName} ${device.deviceType} DeviceID: `
        + `${device.deviceID}, Check Config to see if DeviceID is being Hidden.`);
    }
  }

  private async createValve(location: location, device: resideoDevice & devicesConfig) {
    const uuid = this.api.hap.uuid.generate(`${device.deviceID}-${device.deviceClass}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName} DeviceID: ${device.deviceID}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = device.userDefinedDeviceName;
        existingAccessory.context.deviceID = device.deviceID;
        existingAccessory.context.model = device.deviceClass;
        this.valveFirmwareExistingAccessory(device, existingAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new Valve(this, existingAccessory, location, device);
        this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${existingAccessory.UUID})`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${device.userDefinedDeviceName} ${device.deviceClass} Device ID: ${device.deviceID}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.userDefinedDeviceName, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.deviceID = device.deviceID;
      accessory.context.model = device.deviceClass;
      this.valveFirmwareNewAccessory(device, accessory);

      // accessory.context.firmwareRevision = findaccessories.accessoryAttribute.softwareRevision;
      // create the accessory handler for the newly create accessory
      // this is imported from `/Sensors/valve.ts`
      new Valve(this, accessory, location, device);
      this.debugLog(`${device.deviceClass} uuid: ${device.deviceID}-${device.deviceClass} (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.userDefinedDeviceName} ${device.deviceType} DeviceID: `
        + `${device.deviceID}, Check Config to see if DeviceID is being Hidden.`);
    }
  }

  private async createRoomSensors(
    location: location,
    device: resideoDevice & devicesConfig,
    group: T9groups,
    sensorAccessory: sensorAccessory,
  ) {
    // Room Sensor(s)
    const uuid =
      this.api.hap.uuid.generate(`${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryAttribute.serialNumber}-RoomSensor`);
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`
          + ` Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = sensorAccessory.accessoryAttribute.name;
        existingAccessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber;
        existingAccessory.context.model = sensorAccessory.accessoryAttribute.model;
        this.roomsensorFirmwareExistingAccessory(existingAccessory, sensorAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new RoomSensors(this, existingAccessory, location, device, sensorAccessory, group);
        this.debugLog(
          `${sensorAccessory.accessoryAttribute.type}` +
          ` uuid: ${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensor, (${existingAccessory.UUID})`,
        );
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} ` +
          `Device ID: ${sensorAccessory.accessoryAttribute.serialNumber}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(sensorAccessory.accessoryAttribute.name, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber;
      accessory.context.model = sensorAccessory.accessoryAttribute.model;
      this.roomsensorFirmwareNewAccessory(accessory, sensorAccessory);

      // create the accessory handler for the newly create accessory
      // this is imported from `roomSensor.ts`
      new RoomSensors(this, accessory, location, device, sensorAccessory, group);
      this.debugLog(`${sensorAccessory.accessoryAttribute.type}` +
        ` uuid: ${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensor, (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.errorLog(`Unable to Register new device: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} `
        + `Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}, Check Config to see if DeviceID is being Hidden.`);
    }
  }

  private async createRoomSensorThermostat(
    location: location,
    device: resideoDevice & devicesConfig,
    group: T9groups,
    sensorAccessory: sensorAccessory,
  ) {
    const uuid = this.api.hap.uuid.generate(`${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory: { UUID }) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (await this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`
          + ` Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = sensorAccessory.accessoryAttribute.name;
        existingAccessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber;
        existingAccessory.context.model = sensorAccessory.accessoryAttribute.model;
        this.roomsensorFirmwareExistingAccessory(existingAccessory, sensorAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new RoomSensorThermostat(this, existingAccessory, location, device, sensorAccessory, group);
        this.debugLog(
          `${sensorAccessory.accessoryAttribute.type} Thermostat uuid:` +
          ` ${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-RoomSensorThermostat, (${existingAccessory.UUID})`,
        );
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (await this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      if (!device.external) {
        this.infoLog(`Adding new accessory: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} ` +
          `Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}`);
      }

      // create a new accessory
      const accessory = new this.api.platformAccessory(sensorAccessory.accessoryAttribute.name, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber;
      accessory.context.model = sensorAccessory.accessoryAttribute.model;
      this.roomsensorFirmwareNewAccessory(accessory, sensorAccessory);

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new RoomSensorThermostat(this, accessory, location, device, sensorAccessory, group);
      this.debugLog(`${sensorAccessory.accessoryAttribute.type} Thermostat uuid:` +
        ` ${sensorAccessory.accessoryAttribute.name}-${sensorAccessory.accessoryAttribute.type}-${sensorAccessory.accessoryId}-` +
        `RoomSensorThermostat, (${accessory.UUID})`);

      // publish device externally or link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.debugErrorLog(`Unable to Register new device: ${sensorAccessory.accessoryAttribute.name} ${sensorAccessory.accessoryAttribute.type} `
        + `Serial Number: ${sensorAccessory.accessoryAttribute.serialNumber}, Check Config to see if DeviceID is being Hidden.`);
    }
  }

  async registerDevice(device: resideoDevice & devicesConfig) {
    let registerDevice: boolean;
    this.debugLog(`Device: ${device.userDefinedDeviceName} hide_roomsensor: ${device.thermostat?.roomsensor?.hide_roomsensor},`
      + ` roompriority: ${device.thermostat?.roompriority?.deviceType}, hide_device: ${device.hide_device}`);
    if (!device.thermostat?.roomsensor?.hide_roomsensor) {
      registerDevice = true;
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`);
    } else if (device.thermostat?.roompriority?.deviceType) {
      registerDevice = true;
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`);
    } else if (!device.hide_device) {
      registerDevice = true;
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`);
    } else {
      registerDevice = false;
      this.debugSuccessLog(`Device: ${device.userDefinedDeviceName} deviceID: ${device.deviceID}, registerDevice: ${registerDevice}`);
    }
    if (registerDevice === true) {
      this.debugWarnLog(`Device: ${device.userDefinedDeviceName} will display in HomeKit`);
    } else {
      this.debugErrorLog(`Device: ${device.userDefinedDeviceName} will not display in HomeKit`);
    }
    return registerDevice;
  }

  private leaksensorFirmwareNewAccessory(device: resideoDevice & devicesConfig, accessory: PlatformAccessory) {
    if (device.firmware) {
      accessory.context.firmwareRevision = device.firmware;
    } else {
      accessory.context.firmwareRevision = this.version;
    }
  }

  private leaksensorFirmwareExistingAccessory(device: resideoDevice & devicesConfig, existingAccessory: PlatformAccessory) {
    if (device.firmware) {
      existingAccessory.context.firmwareRevision = device.firmware;
    } else {
      existingAccessory.context.firmwareRevision = this.version;
    }
  }

  private valveFirmwareNewAccessory(device: resideoDevice & devicesConfig, accessory: PlatformAccessory) {
    if (device.firmware) {
      accessory.context.firmwareRevision = device.firmware;
    } else {
      accessory.context.firmwareRevision = this.version;
    }
  }

  private valveFirmwareExistingAccessory(device: resideoDevice & devicesConfig, existingAccessory: PlatformAccessory) {
    if (device.firmware) {
      existingAccessory.context.firmwareRevision = device.firmware;
    } else {
      existingAccessory.context.firmwareRevision = this.version;
    }
  }

  private roomsensorFirmwareNewAccessory(accessory, sensorAccessory: sensorAccessory) {
    if (accessory.firmware) {
      accessory.context.firmwareRevision = accessory.firmware;
    } else {
      accessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision || this.version;
    }
  }

  private roomsensorFirmwareExistingAccessory(existingAccessory, sensorAccessory: sensorAccessory) {
    if (existingAccessory.firmware) {
      existingAccessory.context.firmwareRevision = existingAccessory.firmware;
    } else {
      existingAccessory.context.firmwareRevision = sensorAccessory.accessoryAttribute.softwareRevision || this.version;
    }
  }

  public async thermostatFirmwareNewAccessory(device: resideoDevice & devicesConfig, accessory: PlatformAccessory, location: any) {
    if (device.firmware) {
      accessory.context.firmwareRevision = device.firmware;
    } else {
      if (device.deviceModel.startsWith('T9')) {
        try {
          accessory.context.firmwareRevision = await this.getSoftwareRevision(location.locationID, device);
        } catch (e: any) {
          this.action = 'Get T9 Firmware Version';
          this.apiError(e);
        }
      } else if (device.deviceModel.startsWith('Round') || device.deviceModel.startsWith('Unknown') || device.deviceModel.startsWith('D6')) {
        accessory.context.firmwareRevision = device.thermostatVersion;
      } else {
        accessory.context.firmwareRevision = this.version;
      }
    }
  }

  public async thermostatFirmwareExistingAccessory(
    device: resideoDevice & devicesConfig,
    existingAccessory: PlatformAccessory,
    location: any,
  ) {
    if (device.firmware) {
      existingAccessory.context.firmwareRevision = device.firmware;
    } else {
      if (device.deviceModel.startsWith('T9')) {
        try {
          existingAccessory.context.firmwareRevision = await this.getSoftwareRevision(location.locationID, device);
        } catch (e: any) {
          this.action = 'Get T9 Firmware Version';
          this.apiError(e);
        }
      } else if (device.deviceModel.startsWith('Round') || device.deviceModel.startsWith('Unknown') || device.deviceModel.startsWith('D6')) {
        existingAccessory.context.firmwareRevision = device.thermostatVersion;
      } else {
        existingAccessory.context.firmwareRevision = this.version;
      }
    }
  }

  public async externalOrPlatform(device: resideoDevice & devicesConfig, accessory: PlatformAccessory) {
    if (device.external) {
      this.warnLog(`${accessory.displayName} External Accessory Mode`);
      this.externalAccessory(accessory);
    } else {
      this.debugLog(`${accessory.displayName} External Accessory Mode: ${device.external}`);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  public async externalAccessory(accessory: PlatformAccessory) {
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.warnLog(`Removing existing accessory from cache: ${existingAccessory.displayName}`);
  }

  apiError(e: any) {
    if (e.message.includes('400')) {
      this.errorLog(`Failed to ${this.action}: Bad Request`);
      this.debugLog('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.errorLog(`Failed to ${this.action}: Unauthorized Request`);
      this.debugLog('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.errorLog(`Failed to ${this.action}: Forbidden Request`);
      this.debugLog('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.errorLog(`Failed to ${this.action}: Requst Not Found`);
      this.debugLog('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.errorLog(`Failed to ${this.action}: Request Not Acceptable`);
      this.debugLog('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.errorLog(`Failed to ${this.action}: Unsupported Requst Header`);
      this.debugLog('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.errorLog(`Failed to ${this.action}: Unprocessable Entity`);
      this.debugLog(
        'The client has made a valid request, but the server cannot process it.' +
        ' This is often used for APIs for which certain limits have been exceeded.');
    } else if (e.message.includes('429')) {
      this.errorLog(`Failed to ${this.action}: Too Many Requests`);
      this.debugLog('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.errorLog(`Failed to ${this.action}: Internal Server Error`);
      this.debugLog('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.errorLog(`Failed to ${this.action}`);
    }
    this.debugErrorLog(`Failed to ${this.action}, Error Message: ${stringify(e.message)}`);
  }

  async statusCode(statusCode: number, action: string): Promise<void> {
    switch (statusCode) {
      case 200:
        this.debugLog(`Standard Response, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 400:
        this.errorLog(`Bad Request, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 401:
        this.errorLog(`Unauthorized, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 404:
        this.errorLog(`Not Found, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 429:
        this.errorLog(`Too Many Requests, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 500:
        this.errorLog(`Internal Server Error (Meater Server), statusCode: ${statusCode}, Action: ${action}`);
        break;
      default:
        this.infoLog(`Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-resideo-bug-report. Action: ${action}`);
    }
  }

  async getPlatformConfigSettings() {
    const platformConfig: ResideoPlatformConfig['options'] = {};
    if (this.config.options) {
      if (this.config.options.logging) {
        platformConfig.logging = this.config.options.logging;
      }
      if (this.config.options.refreshRate) {
        platformConfig.refreshRate = this.config.options.refreshRate;
      }
      if (this.config.options.pushRate) {
        platformConfig.pushRate = this.config.options.pushRate;
      }
      if (Object.entries(platformConfig).length !== 0) {
        this.debugLog(`Platform Config: ${JSON.stringify(platformConfig)}`);
      }
      this.platformConfig = platformConfig;
    }
  }

  async getPlatformLogSettings() {
    this.debugMode = process.argv.includes('-D') ?? process.argv.includes('--debug');
    if (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard' || this.config.options?.logging === 'none') {
      this.platformLogging = this.config.options.logging;
      await this.debugWarnLog(`Using Config Logging: ${this.platformLogging}`);
    } else if (this.debugMode) {
      this.platformLogging = 'debugMode';
      await this.debugWarnLog(`Using ${this.platformLogging} Logging`);
    } else {
      this.platformLogging = 'standard';
      await this.debugWarnLog(`Using ${this.platformLogging} Logging`);
    }
  }

  async getVersion() {
    const json = JSON.parse(
      await readFile(
        new URL('../package.json', import.meta.url),
        'utf-8'),
    );
    this.debugLog(`Plugin Version: ${json.version}`);
    this.version = json.version;
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.info(String(...log));
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.success(String(...log));
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.success('[DEBUG]', String(...log));
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.warn(String(...log));
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      this.log.error(String(...log));
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingPlatformLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log));
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      }
    }
  }

  async enablingPlatformLogging(): Promise<boolean> {
    return this.platformLogging.includes('debug') ?? this.platformLogging === 'standard';
  }
}
