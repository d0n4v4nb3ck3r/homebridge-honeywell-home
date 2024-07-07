/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * device.ts: homebridge-resideo.
 */
import type { ResideoPlatform } from '../platform.js';
import type { API, HAP, Logging, PlatformAccessory } from 'homebridge';
import type { ResideoPlatformConfig, resideoDevice, sensorAccessory, T9groups, location, devicesConfig } from '../settings.js';

export abstract class deviceBase {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;

  // Config
  protected deviceLogging!: string;
  protected deviceRefreshRate!: number;
  protected devicePushRate!: number;
  protected deviceMaxRetries!: number;
  protected deviceDelayBetweenRetries!: number;

  constructor(
    protected readonly platform: ResideoPlatform,
    protected accessory: PlatformAccessory,
    protected location: location,
    protected device: resideoDevice & devicesConfig,
    public sensorAccessory?: sensorAccessory,
    public readonly group?: T9groups,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;


    this.getDeviceLogSettings(accessory, device);
    this.getDeviceRateSettings(accessory, device);
    this.getDeviceRetry(device);
    this.getDeviceConfigSettings(device);
    this.getDeviceContext(accessory, device, sensorAccessory);

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Name, accessory.context.name)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, accessory.context.name)
      .setCharacteristic(this.hap.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, accessory.context.deviceID);
  }

  async getDeviceLogSettings(accessory: PlatformAccessory, device: resideoDevice & devicesConfig): Promise<void> {
    this.deviceLogging = this.platform.debugMode ? 'debugMode' : device.logging ?? this.config.logging ?? 'standard';
    const logging = this.platform.debugMode ? 'Debug Mode' : device.logging ? 'Device Config' : this.config.logging ? 'Platform Config' : 'Default';
    accessory.context.deviceLogging = this.deviceLogging;
    await this.debugLog(`Using ${logging} Logging: ${this.deviceLogging}`);
  }

  async getDeviceRateSettings(accessory: PlatformAccessory, device: resideoDevice & devicesConfig): Promise<void> {
    // refreshRate
    this.deviceRefreshRate = device.thermostat?.roomsensor?.refreshRate ?? device.thermostat?.roompriority?.refreshRate ?? device.refreshRate
      ?? this.config.options?.refreshRate ?? 120;
    const refreshRate = device.thermostat?.roomsensor?.refreshRate ? 'Room Sensor Config'
      : device.thermostat?.roompriority?.refreshRate ? 'Room Priority Config' : device.refreshRate ? 'Device Config'
        : this.config.options?.refreshRate ? 'Platform Config' : 'Default';
    accessory.context.deviceRefreshRate = this.deviceRefreshRate;
    // pushRate
    this.devicePushRate = device.pushRate ?? this.config.options?.pushRate ?? 0.1;
    const pushRate = device.pushRate ? 'Device Config' : this.config.options?.pushRate ? 'Platform Config' : 'Default';
    await this.debugLog(`Using ${refreshRate} refreshRate: ${this.deviceRefreshRate}, ${pushRate} pushRate: ${this.devicePushRate}`);
    accessory.context.devicePushRate = this.devicePushRate;
  }

  async getDeviceRetry(device: resideoDevice & devicesConfig): Promise<void> {
    if (device.maxRetries) {
      this.deviceMaxRetries = device.maxRetries;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Using Device Max Retries: ${this.deviceMaxRetries}`);
    } else {
      this.deviceMaxRetries = 5; // Maximum number of retries
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Max Retries Not Set, Using: ${this.deviceMaxRetries}`);
    }
    if (device.delayBetweenRetries) {
      this.deviceDelayBetweenRetries = device.delayBetweenRetries * 1000;
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName}`
        + ` Using Device Delay Between Retries: ${this.deviceDelayBetweenRetries}`);
    } else {
      this.deviceDelayBetweenRetries = 3000; // Delay between retries in milliseconds
      this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Delay Between Retries Not Set,`
        + ` Using: ${this.deviceDelayBetweenRetries}`);
    }
  }

  async getDeviceConfigSettings(device: resideoDevice & devicesConfig): Promise<void> {
    const deviceConfig = {};
    if (device.logging !== 'standard') {
      deviceConfig['logging'] = device.logging;
    }
    if (device.external === true) {
      deviceConfig['external'] = device.external;
    }
    if (device.refreshRate !== 0) {
      deviceConfig['refreshRate'] = device.refreshRate;
    }
    if (device.pushRate !== 0) {
      deviceConfig['pushRate'] = device.pushRate;
    }
    if (device.retry === true) {
      deviceConfig['retry'] = device.retry;
    }
    if (device.maxRetries !== 0) {
      deviceConfig['maxRetries'] = device.maxRetries;
    }
    if (device.delayBetweenRetries !== 0) {
      deviceConfig['delayBetweenRetries'] = device.delayBetweenRetries;
    }
    let thermostatConfig = {};
    if (device.thermostat) {
      thermostatConfig = device.thermostat;
    }
    let leaksensorConfig = {};
    if (device.leaksensor) {
      leaksensorConfig = device.leaksensor;
    }
    let valveConfig = {};
    if (device.valve) {
      valveConfig = device.valve;
    }
    const config = Object.assign({}, deviceConfig, thermostatConfig, leaksensorConfig, valveConfig);
    if (Object.entries(config).length !== 0) {
      this.debugSuccessLog(`${this.device.deviceClass}: ${this.accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }

  async getDeviceContext(accessory: PlatformAccessory, device: resideoDevice & devicesConfig, sensorAccessory?: sensorAccessory): Promise<void> {
    if (sensorAccessory?.accessoryAttribute) {
      accessory.context.name = sensorAccessory.accessoryAttribute.name;
      accessory.context.model = sensorAccessory.accessoryAttribute.model;
      accessory.context.deviceID = sensorAccessory.accessoryAttribute.serialNumber;
      accessory.context.deviceType = sensorAccessory.accessoryAttribute.type;
    } else if (device.deviceClass) {
      accessory.context.name = device.userDefinedDeviceName ?? device.name;
      accessory.context.model = device.deviceClass ?? device.deviceModel;
      accessory.context.deviceID = device.deviceID;
      accessory.context.deviceType = device.deviceType;
    }

    // Firmware Version
    const deviceFirmwareVersion = sensorAccessory?.accessoryAttribute.softwareRevision ?? device.firmware ?? device.firmwareVersion
      ?? device.thermostatVersion ?? accessory.context.version ?? this.platform.version ?? '0.0.0';
    const version = deviceFirmwareVersion.toString();
    this.debugLog(`${this.device.deviceType}: ${accessory.displayName} Firmware Version: ${version?.replace(/^V|-.*$/g, '')}`);
    let deviceVersion: string;
    if (version?.includes('.') === false) {
      const replace = version?.replace(/^V|-.*$/g, '');
      const match = replace?.match(/.{1,1}/g);
      const validVersion = match?.join('.');
      deviceVersion = validVersion ?? '0.0.0';
    } else {
      deviceVersion = version?.replace(/^V|-.*$/g, '') ?? '0.0.0';
    }
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, deviceVersion)
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, deviceVersion)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, deviceVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(deviceVersion);
    accessory.context.deviceVersion = deviceVersion;
    this.debugSuccessLog(`${device.deviceType}: ${accessory.displayName} deviceVersion: ${accessory.context.deviceVersion}`);
  }

  async statusCode(statusCode: number, action: string): Promise<void> {
    switch (statusCode) {
      case 200:
        this.debugLog(`${this.device.deviceClass}: ${this.accessory.displayName} Standard Response, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 400:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Bad Request, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 401:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 403:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Forbidden,	The request has been authenticated but does not `
          + `have appropriate permissions, or a requested resource is not found, statusCode: ${statusCode}`);
        break;
      case 404:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Not Found, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 429:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}, Action: ${action}`);
        break;
      case 500:
        this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}, `
          + `Action: ${action}`);
        break;
      default:
        this.infoLog(`${this.device.deviceClass}: ${this.accessory.displayName} Unknown statusCode: ${statusCode}, `
          + `Action: ${action}, Report Bugs Here: https://bit.ly/homebridge-resideo-bug-report`);
    }
  }


  async resideoAPIError(e: any, action: string): Promise<void> {
    if (e.message.includes('400')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Bad Request`);
      this.debugLog('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Unauthorized Request`);
      this.debugLog('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Forbidden Request`);
      this.debugLog('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Requst Not Found`);
      this.debugLog('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Request Not Acceptable`);
      this.debugLog('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Unsupported Requst Header`);
      this.debugLog('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Unprocessable Entity`);
      this.debugLog(
        'The client has made a valid request, but the server cannot process it.' +
        ' This is often used for APIs for which certain limits have been exceeded.');
    } else if (e.message.includes('429')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Too Many Requests`);
      this.debugLog('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action}, Internal Server Error`);
      this.debugLog('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to ${action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.errorLog(`${this.device.deviceClass}: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  /**
   * Logging for Device
   */
  async infoLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.info(`${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
    }
  }

  async successLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.success(`${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
    }
  }

  async debugSuccessLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.success(`[DEBUG] ${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async warnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.warn(`${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
    }
  }

  async debugWarnLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.warn(`[DEBUG] ${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async errorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      this.log.error(`${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
    }
  }

  async debugErrorLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.log.error(`[DEBUG] ${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async debugLog(...log: any[]): Promise<void> {
    if (await this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.log.info(`[DEBUG] ${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
      } else {
        this.log.debug(`${this.device.deviceType}: ${this.accessory.displayName}`, String(...log));
      }
    }
  }

  async enablingDeviceLogging(): Promise<boolean> {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}