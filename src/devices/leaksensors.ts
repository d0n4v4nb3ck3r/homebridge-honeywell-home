/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * leaksensors.ts: homebridge-resideo.
 */
import { request } from 'undici';
import { interval, Subject } from 'rxjs';
import { skipWhile, take } from 'rxjs/operators';
import { ResideoPlatform } from '../platform.js';
import { Service, PlatformAccessory, CharacteristicValue, HAP, API, Logging } from 'homebridge';
import { DeviceURL, ResideoPlatformConfig, devicesConfig, location, resideoDevice } from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LeakSensor {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;
  // Services
  service: Service;
  temperatureService?: Service;
  humidityService?: Service;
  leakService?: Service;

  // CharacteristicValue
  StatusActive!: CharacteristicValue;
  LeakDetected!: CharacteristicValue;
  BatteryLevel!: CharacteristicValue;
  ChargingState!: CharacteristicValue;
  FirmwareRevision!: CharacteristicValue;
  StatusLowBattery!: CharacteristicValue;
  CurrentTemperature!: CharacteristicValue;
  CurrentRelativeHumidity!: CharacteristicValue;

  // Others
  action!: string;
  temperature!: number;
  hasDeviceCheckedIn!: boolean;
  humidity!: number;
  batteryRemaining!: number;
  waterPresent!: boolean;
  debugMode!: boolean;

  // Config
  deviceLogging!: string;
  deviceRefreshRate!: number;

  // Updates
  SensorUpdateInProgress!: boolean;
  doSensorUpdate!: Subject<void>;

  constructor(
    private readonly platform: ResideoPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly locationId: location['locationID'],
    public device: resideoDevice & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;
    this.deviceLogs(device);
    this.getDeviceRefreshRate(device);
    this.deviceConfigOptions(device);
    this.deviceContext(accessory);

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doSensorUpdate = new Subject();
    this.SensorUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Model, device.deviceType)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.FirmwareRevision);

    // get the Battery service if it exists, otherwise create a new Battery service
    (this.service = this.accessory.getService(this.hap.Service.Battery) || this.accessory.addService(this.hap.Service.Battery)),
    `${accessory.displayName} Battery`;

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.hap.Characteristic.Name, accessory.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/

    // Do initial device parse
    this.parseStatus();

    // Set Charging State
    this.service.setCharacteristic(this.hap.Characteristic.ChargingState, 2);

    // Leak Sensor Service
    if (this.device.leaksensor?.hide_leak) {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Removing Leak Sensor Service`);
      this.leakService = this.accessory.getService(this.hap.Service.LeakSensor);
      accessory.removeService(this.leakService!);
    } else if (!this.leakService) {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Add Leak Sensor Service`);
      (this.leakService = this.accessory.getService(this.hap.Service.LeakSensor)
        || this.accessory.addService(this.hap.Service.LeakSensor)), `${accessory.displayName} Leak Sensor`;

      this.leakService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Leak Sensor`);
    } else {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Leak Sensor Service Not Added`);
    }

    // Temperature Sensor Service
    if (this.device.leaksensor?.hide_temperature) {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Removing Temperature Sensor Service`);
      this.temperatureService = this.accessory.getService(this.hap.Service.TemperatureSensor);
      accessory.removeService(this.temperatureService!);
    } else if (!this.temperatureService) {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Add Temperature Sensor Service`);
      (this.temperatureService =
        this.accessory.getService(this.hap.Service.TemperatureSensor) || this.accessory.addService(this.hap.Service.TemperatureSensor)),
      `${accessory.displayName} Temperature Sensor`;

      this.temperatureService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Temperature Sensor`);

      this.temperatureService
        .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
        .setProps({
          minValue: -273.15,
          maxValue: 100,
          minStep: 0.1,
        })
        .onGet(async () => {
          return this.CurrentTemperature;
        });
    } else {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Temperature Sensor Service Not Added`);
    }

    // Humidity Sensor Service
    if (this.device.leaksensor?.hide_humidity) {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Removing Humidity Sensor Service`);
      this.humidityService = this.accessory.getService(this.hap.Service.HumiditySensor);
      accessory.removeService(this.humidityService!);
    } else if (!this.humidityService) {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Add Humidity Sensor Service`);
      (this.humidityService =
        this.accessory.getService(this.hap.Service.HumiditySensor) || this.accessory.addService(this.hap.Service.HumiditySensor)),
      `${accessory.displayName} Humidity Sensor`;

      this.humidityService.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Humidity Sensor`);

      this.humidityService
        .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
        .setProps({
          minStep: 0.1,
        })
        .onGet(async () => {
          return this.CurrentRelativeHumidity;
        });
    } else {
      this.log.debug(`Leak Sensor: ${accessory.displayName} Humidity Sensor Service Not Added`);
    }

    // Retrieve initial values and updateHomekit
    this.refreshStatus();
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    // Active
    this.StatusActive = this.hasDeviceCheckedIn;
    // Leak Service
    if (this.waterPresent === true) {
      this.LeakDetected = 1;
    } else {
      this.LeakDetected = 0;
    }
    this.log.debug(`Leak Sensor: ${this.accessory.displayName} LeakDetected: ${this.LeakDetected}`);

    // Temperature Service
    if (!this.device.leaksensor?.hide_temperature) {
      this.CurrentTemperature = this.temperature;
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} CurrentTemperature: ${this.CurrentTemperature}°`);
    }

    // Humidity Service
    if (!this.device.leaksensor?.hide_humidity) {
      this.CurrentRelativeHumidity = this.humidity;
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}%`);
    }

    // Battery Service
    this.BatteryLevel = Number(this.device.batteryRemaining);
    this.service.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.BatteryLevel);
    if (this.device.batteryRemaining < 15) {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    this.log.debug(`Leak Sensor: ${this.accessory.displayName} BatteryLevel: ${this.BatteryLevel},` + ` StatusLowBattery: ${this.StatusLowBattery}`);
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const { body, statusCode } = await request(`${DeviceURL}/waterLeakDetectors/${this.device.deviceID}`, {
        method: 'GET',
        query: {
          'locationId': this.locationId,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const action = 'refreshStatus';
      await this.statusCode(statusCode, action);
      const device: any = await body.json();
      this.log.debug(`(refreshStatus) ${device.deviceClass}: ${JSON.stringify(device)}`);
      this.device = device;
      this.batteryRemaining = Number(device.batteryRemaining);
      this.waterPresent = device.waterPresent;
      this.humidity = device.currentSensorReadings.humidity;
      this.hasDeviceCheckedIn = device.hasDeviceCheckedIn;
      this.temperature = device.currentSensorReadings.temperature;
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} device: ${JSON.stringify(this.device)}`);
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.action = 'refreshStatus';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.BatteryLevel === undefined) {
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} BatteryLevel: ${this.BatteryLevel}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.BatteryLevel);
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} updateCharacteristic BatteryLevel: ${this.BatteryLevel}`);
    }
    if (this.StatusLowBattery === undefined) {
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} StatusLowBattery: ${this.StatusLowBattery}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.StatusLowBattery);
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.StatusLowBattery}`);
    }
    if (!this.device.leaksensor?.hide_leak) {
      if (this.LeakDetected === undefined) {
        this.log.debug(`Leak Sensor: ${this.accessory.displayName} LeakDetected: ${this.LeakDetected}`);
      } else {
        this.leakService?.updateCharacteristic(this.hap.Characteristic.LeakDetected, this.LeakDetected);
        this.log.debug(`Leak Sensor: ${this.accessory.displayName} updateCharacteristic LeakDetected: ${this.LeakDetected}`);
      }
      if (this.StatusActive === undefined) {
        this.log.debug(`Leak Sensor: ${this.accessory.displayName} StatusActive: ${this.StatusActive}`);
      } else {
        this.leakService?.updateCharacteristic(this.hap.Characteristic.StatusActive, this.StatusActive);
        this.log.debug(`Leak Sensor: ${this.accessory.displayName} updateCharacteristic StatusActive: ${this.StatusActive}`);
      }
    }
    if (this.device.leaksensor?.hide_temperature || this.CurrentTemperature === undefined) {
      if (!this.device.leaksensor?.hide_temperature) {
        this.log.debug(`Leak Sensor: ${this.accessory.displayName} CurrentTemperature: ${this.CurrentTemperature}`);
      }
    } else {
      this.temperatureService?.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.CurrentTemperature);
      this.log.debug(`Leak Sensor: ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.CurrentTemperature}`);
    }
    if (this.device.leaksensor?.hide_humidity || this.CurrentRelativeHumidity === undefined) {
      if (!this.device.leaksensor?.hide_humidity) {
        this.log.debug(`Leak Sensor: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
      }
    } else {
      this.humidityService?.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      this.log.debug(`Leak Sensor: ${this.accessory.displayName}` + ` updateCharacteristic CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
    }
  }

  async apiError(e: any): Promise<void> {
    this.service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, e);
    this.service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, e);
    if (!this.device.leaksensor?.hide_leak) {
      this.leakService?.updateCharacteristic(this.hap.Characteristic.LeakDetected, e);
      this.leakService?.updateCharacteristic(this.hap.Characteristic.StatusActive, e);
    }
    //throw new this.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  async resideoAPIError(e: any): Promise<void> {
    if (this.device.retry) {
      if (this.action === 'refreshStatus') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.SensorUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      }
    }
    if (e.message.includes('400')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Bad Request`);
      this.log.debug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Unauthorized Request`);
      this.log.debug('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Forbidden Request`);
      this.log.debug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Requst Not Found`);
      this.log.debug('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Request Not Acceptable`);
      this.log.debug('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Unsupported Requst Header`);
      this.log.debug('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Unprocessable Entity`);
      this.log.debug(
        'The client has made a valid request, but the server cannot process it.' +
        ' This is often used for APIs for which certain limits have been exceeded.',
      );
    } else if (e.message.includes('429')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Too Many Requests`);
      this.log.debug('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action}, Internal Server Error`);
      this.log.debug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to ${this.action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.log.error(`Leak Sensor: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  async statusCode(statusCode: number, action: string): Promise<void> {
    switch (statusCode) {
      case 200:
        this.log.debug(`${this.device.deviceClass}: ${this.accessory.displayName} Standard Response, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 400:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Bad Request, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 401:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 404:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Not Found, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 429:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 500:
        this.log.error(`${this.device.deviceClass}: ${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}, `
          + `Action: ${action}`);
        break;
      default:
        this.log.info(`${this.device.deviceClass}: ${this.accessory.displayName} Unknown statusCode: ${statusCode}, `
          + `Action: ${action}, Report Bugs Here: https://bit.ly/homebridge-resideo-bug-report`);
    }
  }

  async deviceContext(accessory: PlatformAccessory) {
    if (accessory.context.StatusActive === undefined) {
      this.StatusActive = false;
    } else {
      this.StatusActive = accessory.context.StatusActive;
    }
    if (accessory.context.LeakDetected === undefined) {
      this.LeakDetected = this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
    } else {
      this.LeakDetected = accessory.context.LeakDetected;
    }
    if (accessory.context.BatteryLevel === undefined) {
      this.BatteryLevel = 100;
    } else {
      this.BatteryLevel = accessory.context.BatteryLevel;
    }
    if (accessory.context.ChargingState === undefined) {
      this.ChargingState = this.hap.Characteristic.ChargingState.NOT_CHARGING;
    } else {
      this.ChargingState = accessory.context.ChargingState;
    }
    if (accessory.context.StatusLowBattery === undefined) {
      this.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    } else {
      this.StatusLowBattery = accessory.context.StatusLowBattery;
    }
    if (accessory.context.CurrentTemperature === undefined) {
      this.CurrentTemperature = 20;
    } else {
      this.CurrentTemperature = accessory.context.CurrentTemperature;
    }
    if (accessory.context.CurrentRelativeHumidity === undefined) {
      this.CurrentRelativeHumidity = 50;
    } else {
      this.CurrentRelativeHumidity = accessory.context.CurrentRelativeHumidity;
    }
    if (accessory.context.FirmwareRevision === undefined) {
      this.FirmwareRevision = 'v2.0.0';
    } else {
      this.FirmwareRevision = accessory.context.FirmwareRevision;
    }
  }

  async deviceConfigOptions(device: device & devicesConfig): Promise<void> {
    let config = {};
    if (device.lock) {
      config = device.lock || '';
    }
    if (device.logging !== undefined) {
      config['logging'] = device.logging;
    }
    if (device.refreshRate !== undefined) {
      config['refreshRate'] = device.refreshRate;
    }
    if (device.lock?.hide_lock !== undefined) {
      config['hide_lock'] = this.hide_lock;
    }
    if (Object.entries(config).length !== 0) {
      this.infoLog(`Lock: ${this.accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }

  async getDeviceRefreshRate(device: device & devicesConfig): Promise<void> {
    if (device.refreshRate) {
      if (device.refreshRate < 1800) {
        device.refreshRate = 1800;
        this.warnLog('Refresh Rate cannot be set to lower the 5 mins, as Lock detail (battery level, etc) are unlikely to change within that period');
      }
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.platform.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.platform.config.options!.refreshRate;
      this.debugLog(`Lock: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  async deviceLogs(device: device & devicesConfig): Promise<void> {
    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
    this.deviceLogging = this.device.logging || this.config.options?.logging || 'standard';
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  async deviceLogs() {
    this.deviceLogging = this.device.logging || this.config.options?.logging || 'standard';
    if (this.platform.debugMode) {
      this.deviceLogging = 'debugMode';
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (this.device.logging) {
      this.deviceLogging = this.device.logging;
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.config.options?.logging) {
      this.deviceLogging = this.config.options?.logging;
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = 'standard';
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.info(String(...log));
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.warn(String(...log));
    }
  }

  debugWarnLog({ log = [] }: { log?: any[]; } = {}): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debugMode') {
        this.log.debug('[HOMEBRIDGE DEBUGMODE]', String(...log));
      } else if (this.deviceLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      }
      /*if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }*/
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}
