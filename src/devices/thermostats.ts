<<<<<<< Updated upstream
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { interval, Subject } from 'rxjs';
import superStringify from 'super-stringify';
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators';
import { ResideoPlatform } from '../platform';
import * as settings from '../settings';
=======
import { request } from 'undici';
import { interval, Subject } from 'rxjs';
import { ResideoPlatform } from '../platform.js';
import { debounceTime, take, tap, skipWhile } from 'rxjs/operators';
import { API, CharacteristicValue, HAP, Service, PlatformAccessory, Logging } from 'homebridge';
import {
  DeviceURL, FanChangeableValues, devicesConfig, holdModes, location, modes, resideoDevice, payload, ResideoPlatformConfig,
} from '../settings.js';
>>>>>>> Stashed changes

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Thermostats {
<<<<<<< Updated upstream
=======
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;
  // Services
>>>>>>> Stashed changes
  service!: Service;
  fanService?: Service;
  humidityService?: Service;
  statefulService?: Service;

  // Thermostat Characteristics
  TargetTemperature!: CharacteristicValue;
  CurrentTemperature!: CharacteristicValue;
  CurrentRelativeHumidity?: CharacteristicValue;
  TemperatureDisplayUnits!: CharacteristicValue;
  ProgrammableSwitchEvent!: CharacteristicValue;
  TargetHeatingCoolingState!: CharacteristicValue;
  CurrentHeatingCoolingState!: CharacteristicValue;
  CoolingThresholdTemperature!: CharacteristicValue;
  HeatingThresholdTemperature!: CharacteristicValue;
  ProgrammableSwitchOutputState!: CharacteristicValue;

  // Fan Characteristics
  Active!: CharacteristicValue;
  TargetFanState!: CharacteristicValue;

  // Others
  modes: settings.modes;
  holdModes: settings.holdModes;
  action!: string;
  heatSetpoint!: number;
  coolSetpoint!: number;
  thermostatSetpointStatus!: string;
  resideoMode!: Array<string>;
  resideoHold!: Array<string>;
  fanMode!: settings.FanChangeableValues;

  // Others - T9 Only
  roompriority!: any;

  // Thermostat Updates
  thermostatUpdateInProgress!: boolean;
  doThermostatUpdate!: Subject<void>;

  // Fan Updates
  fanUpdateInProgress!: boolean;
  doFanUpdate!: Subject<void>;

  // Config
  deviceLogging!: string;
  deviceRefreshRate!: number;

  // Room Updates - T9 Only
  roomUpdateInProgress!: boolean;
  doRoomUpdate!: Subject<void>;

  constructor(
    private readonly platform: ResideoPlatform,
<<<<<<< Updated upstream
    private accessory: PlatformAccessory,
    public readonly locationId: settings.location['locationID'],
    public device: settings.device & settings.devicesConfig,
  ) {
    this.logs(device);
    this.refreshRate(device);
    this.config(device);
=======
    private readonly accessory: PlatformAccessory,
    public readonly locationId: location['locationID'],
    public device: resideoDevice & devicesConfig,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;


    this.TargetTemperature = accessory.context.TargetTemperature || 20;
    this.CurrentTemperature = accessory.context.CurrentTemperature || 20;
    this.CurrentRelativeHumidity = accessory.context.CurrentRelativeHumidity || 50;
    this.TemperatureDisplayUnits = accessory.context.TemperatureDisplayUnits || this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS;
    this.ProgrammableSwitchEvent = accessory.context.ProgrammableSwitchEvent || this.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
    this.TargetHeatingCoolingState = accessory.context.TargetHeatingCoolingState || this.hap.Characteristic.TargetHeatingCoolingState.AUTO;
    this.CurrentHeatingCoolingState = accessory.context.CurrentHeatingCoolingState || this.hap.Characteristic.CurrentHeatingCoolingState.OFF;
    this.CoolingThresholdTemperature = accessory.context.CoolingThresholdTemperature || 20;
    this.HeatingThresholdTemperature = accessory.context.HeatingThresholdTemperature || 22;
    this.ProgrammableSwitchOutputState = accessory.context.ProgrammableSwitchOutputState || 0;
    accessory.context.FirmwareRevision = 'v2.0.0';

    this.Active = accessory.context.Active || this.hap.Characteristic.Active.ACTIVE;
    this.TargetFanState = accessory.context.TargetFanState || this.hap.Characteristic.TargetFanState.MANUAL;
>>>>>>> Stashed changes
    // Map Resideo Modes to HomeKit Modes
    this.modes = {
      Off: platform.Characteristic.TargetHeatingCoolingState.OFF,
      Heat: platform.Characteristic.TargetHeatingCoolingState.HEAT,
      Cool: platform.Characteristic.TargetHeatingCoolingState.COOL,
      Auto: platform.Characteristic.TargetHeatingCoolingState.AUTO,
    };
    // Map Resideo Hold Modes to HomeKit StatefulProgrammableSwitch Events
    this.holdModes = {
      NoHold: platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      TemporaryHold:	platform.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
      PermanentHold:	platform.Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
    };

    // Map HomeKit Modes to Resideo Modes
    // Don't change the order of these!
    this.resideoMode = ['Off', 'Heat', 'Cool', 'Auto'];
    this.resideoHold = ['NoHold', 'TemporaryHold', 'PermanentHold'];

<<<<<<< Updated upstream
    // default placeholders
    this.Active = this.platform.Characteristic.Active.INACTIVE;
    this.TargetFanState = this.platform.Characteristic.TargetFanState.MANUAL;
=======
>>>>>>> Stashed changes
    if (this.thermostatSetpointStatus === undefined) {
      accessory.context.thermostatSetpointStatus = device.thermostat?.thermostatSetpointStatus;
      this.thermostatSetpointStatus = accessory.context.thermostatSetpointStatus;
      this.log.debug(`Thermostat: ${accessory.displayName} thermostatSetpointStatus: ${this.thermostatSetpointStatus}`);
    }

    // this is subject we use to track when we need to POST changes to the Resideo API for Room Changes - T9 Only
    this.doRoomUpdate = new Subject();
    this.roomUpdateInProgress = false;
    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doThermostatUpdate = new Subject();
    this.thermostatUpdateInProgress = false;
    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doFanUpdate = new Subject();
    this.fanUpdateInProgress = false;

    // set accessory information
    accessory
<<<<<<< Updated upstream
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.platform.Characteristic.Model, device.deviceModel)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.firmwareRevision)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision)
      .updateValue(accessory.context.firmwareRevision);

    //Thermostat Service
    (this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat)),
    accessory.displayName;
=======
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Model, device.deviceModel)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.firmwareRevision);

    //Thermostat Service
    (this.service = this.accessory.getService(this.hap.Service.Thermostat)
      || this.accessory.addService(this.hap.Service.Thermostat)), accessory.displayName;
>>>>>>> Stashed changes

    //Service Name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    //Required Characteristics" see https://developers.homebridge.io/#/service/Thermostat

    //Initial Device Parse
    this.parseStatus();

    // Set Min and Max
    if (device.changeableValues!.heatCoolMode === 'Heat') {
      this.log.debug(`Thermostat: ${accessory.displayName} is in "${device.changeableValues!.heatCoolMode}" mode`);
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetTemperature)
        .setProps({
          minValue: this.toCelsius(device.minHeatSetpoint!),
          maxValue: this.toCelsius(device.maxHeatSetpoint!),
          minStep: 0.1,
        })
        .onGet(() => {
          return this.TargetTemperature!;
        });
    } else {
      this.log.debug(`Thermostat: ${accessory.displayName} is in "${device.changeableValues!.heatCoolMode}" mode`);
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetTemperature)
        .setProps({
          minValue: this.toCelsius(device.minCoolSetpoint!),
          maxValue: this.toCelsius(device.maxCoolSetpoint!),
          minStep: 0.1,
        })
        .onGet(() => {
          return this.TargetTemperature!;
        });
    }

    // The value property of TargetHeaterCoolerState must be one of the following:
    //AUTO = 3; HEAT = 1; COOL = 2; OFF = 0;
    // Set control bindings
    const TargetState = this.TargetState();
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: TargetState,
      })
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).onSet(this.setHeatingThresholdTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).onSet(this.setCoolingThresholdTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).onSet(this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).onSet(this.setTemperatureDisplayUnits.bind(this));

    // Fan Controls
    if (device.thermostat?.hide_fan) {
<<<<<<< Updated upstream
      this.debugLog(`Thermostat: ${accessory.displayName} Removing Fanv2 Service`);
      this.fanService = this.accessory.getService(this.platform.Service.Fanv2);
      accessory.removeService(this.fanService!);
    } else if (!this.fanService && device.settings?.fan) {
      this.debugLog(`Thermostat: ${accessory.displayName} Add Fanv2 Service`);
      this.debugLog(`Thermostat: ${accessory.displayName} Available Fan Settings ${superStringify(device.settings.fan)}`);
      (this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2)),
      `${accessory.displayName} Fan`;
=======
      this.log.debug(`Thermostat: ${accessory.displayName} Removing Fanv2 Service`);
      this.fanService = this.accessory.getService(this.hap.Service.Fanv2);
      accessory.removeService(this.fanService!);
    } else if (!this.fanService && device.settings?.fan) {
      this.log.debug(`Thermostat: ${accessory.displayName} Add Fanv2 Service`);
      this.log.debug(`Thermostat: ${accessory.displayName} Available Fan Settings ${JSON.stringify(device.settings.fan)}`);
      (this.fanService = this.accessory.getService(this.hap.Service.Fanv2)
        || this.accessory.addService(this.hap.Service.Fanv2)), `${accessory.displayName} Fan`;
>>>>>>> Stashed changes

      this.fanService.setCharacteristic(this.platform.Characteristic.Name, `${accessory.displayName} Fan`);

      this.fanService.getCharacteristic(this.platform.Characteristic.Active).onSet(this.setActive.bind(this));

      this.fanService.getCharacteristic(this.platform.Characteristic.TargetFanState).onSet(this.setTargetFanState.bind(this));
    } else {
      this.log.debug(`Thermostat: ${accessory.displayName} Fanv2 Service Not Added`);
    }

    // Humidity Sensor Service
    if (device.thermostat?.hide_humidity) {
<<<<<<< Updated upstream
      this.debugLog(`Thermostat: ${accessory.displayName} Removing Humidity Sensor Service`);
      this.humidityService = this.accessory.getService(this.platform.Service.HumiditySensor);
=======
      this.log.debug(`Thermostat: ${accessory.displayName} Removing Humidity Sensor Service`);
      this.humidityService = this.accessory.getService(this.hap.Service.HumiditySensor);
>>>>>>> Stashed changes
      accessory.removeService(this.humidityService!);
    } else if (!this.humidityService && device.indoorHumidity) {
      this.log.debug(`Thermostat: ${accessory.displayName} Add Humidity Sensor Service`);
      (this.humidityService =
<<<<<<< Updated upstream
        this.accessory.getService(this.platform.Service.HumiditySensor) || this.accessory.addService(this.platform.Service.HumiditySensor)),
      `${device.name} Humidity Sensor`;
=======
        this.accessory.getService(this.hap.Service.HumiditySensor)
        || this.accessory.addService(this.hap.Service.HumiditySensor)), `${device.name} Humidity Sensor`;
>>>>>>> Stashed changes

      this.humidityService.setCharacteristic(this.platform.Characteristic.Name, `${accessory.displayName} Humidity Sensor`);

      this.humidityService
        .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .setProps({
          minStep: 0.1,
        })
        .onGet(() => {
          return this.CurrentRelativeHumidity!;
        });
    } else {
      this.log.debug(`Thermostat: ${accessory.displayName} Humidity Sensor Service Not Added`);
    }

    // get the StatefulProgrammableSwitch service if it exists, otherwise create a new StatefulProgrammableSwitch service
    // you can create multiple services for each accessory
    (this.statefulService =
<<<<<<< Updated upstream
      accessory.getService(this.platform.Service.StatefulProgrammableSwitch) ||
      accessory.addService(this.platform.Service.StatefulProgrammableSwitch)),
    `${accessory.displayName} ${device.deviceModel}`;
=======
      accessory.getService(this.hap.Service.StatefulProgrammableSwitch)
      || accessory.addService(this.hap.Service.StatefulProgrammableSwitch)), `${accessory.displayName} ${device.deviceModel}`;
>>>>>>> Stashed changes

    this.statefulService.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    if (!this.statefulService.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
      this.statefulService.addCharacteristic(this.platform.Characteristic.ConfiguredName, accessory.displayName);
    }

    // create handlers for required characteristics
    this.statefulService.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(this.handleProgrammableSwitchEventGet.bind(this));

    this.statefulService
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchOutputState)
      .onGet(this.handleProgrammableSwitchOutputStateGet.bind(this))
      .onSet(this.handleProgrammableSwitchOutputStateSet.bind(this));

    // Retrieve initial values and updateHomekit
    this.refreshStatus();
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.thermostatUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });

    // Watch for thermostat change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    if (device.thermostat?.roompriority?.deviceType === 'Thermostat' && device.deviceModel === 'T9-T10') {
      this.doRoomUpdate
        .pipe(
          tap(() => {
            this.roomUpdateInProgress = true;
          }),
          debounceTime(this.platform.config.options!.pushRate! * 500),
        )
        .subscribe(async () => {
          try {
            await this.refreshRoomPriority();
          } catch (e: any) {
            this.action = 'refreshRoomPriority';
            this.resideoAPIError(e);
            this.platform.refreshAccessToken();
            this.apiError(e);
          }
          try {
            await this.pushRoomChanges();
          } catch (e: any) {
            this.action = 'pushRoomChanges';
            this.resideoAPIError(e);
            this.platform.refreshAccessToken();
            this.apiError(e);
          }
          this.roomUpdateInProgress = false;
          // Refresh the status from the API
          interval(5000)
            .pipe(skipWhile(() => this.thermostatUpdateInProgress))
            .pipe(take(1))
            .subscribe(async () => {
              await this.refreshStatus();
            });
        });
    }
    this.doThermostatUpdate
      .pipe(
        tap(() => {
          this.thermostatUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges();
        } catch (e: any) {
          this.action = 'pushChanges';
          this.resideoAPIError(e);
          this.platform.refreshAccessToken();
          this.apiError(e);
        }
        this.thermostatUpdateInProgress = false;
        // Refresh the status from the API
        interval(15000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      });
    if (device.settings?.fan && !device.thermostat?.hide_fan) {
      this.doFanUpdate
        .pipe(
          tap(() => {
            this.fanUpdateInProgress = true;
          }),
          debounceTime(this.platform.config.options!.pushRate! * 1000),
        )
        .subscribe(async () => {
          try {
            await this.pushFanChanges();
          } catch (e: any) {
            this.action = 'pushFanChanges';
            this.resideoAPIError(e);
            this.platform.refreshAccessToken();
            this.apiError(e);
          }
          this.fanUpdateInProgress = false;
          // Refresh the status from the API
          interval(5000)
            .pipe(skipWhile(() => this.thermostatUpdateInProgress))
            .pipe(take(1))
            .subscribe(async () => {
              await this.refreshStatus();
            });
        });
    }
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} parseStatus`);
    if (this.device.units === 'Fahrenheit') {
<<<<<<< Updated upstream
      this.TemperatureDisplayUnits = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
      this.debugLog(
=======
      this.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
      this.log.debug(
>>>>>>> Stashed changes
        `Thermostat: ${this.accessory.displayName} parseStatus` +
          ` TemperatureDisplayUnits: ${this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT}`,
      );
    }
    if (this.device.units === 'Celsius') {
<<<<<<< Updated upstream
      this.TemperatureDisplayUnits = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
      this.debugLog(
=======
      this.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS;
      this.log.debug(
>>>>>>> Stashed changes
        `Thermostat: ${this.accessory.displayName} parseStatus` +
          ` TemperatureDisplayUnits: ${this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS}`,
      );
    }

    this.CurrentTemperature = this.toCelsius(this.device.indoorTemperature!);
    this.log.debug(`Thermostat: ${this.accessory.displayName} parseStatus CurrentTemperature: ${this.toCelsius(this.device.indoorTemperature!)}`);

    if (this.device.indoorHumidity) {
      this.CurrentRelativeHumidity = this.device.indoorHumidity;
      this.log.debug(`Thermostat: ${this.accessory.displayName} parseStatus` + ` CurrentRelativeHumidity: ${this.device.indoorHumidity}`);
    }

    if (this.device.changeableValues!.heatSetpoint > 0) {
      this.HeatingThresholdTemperature = this.toCelsius(this.device.changeableValues!.heatSetpoint);
      this.log.debug(
        `Thermostat: ${this.accessory.displayName} parseStatus` +
          ` HeatingThresholdTemperature: ${this.toCelsius(this.device.changeableValues!.heatSetpoint)}`,
      );
    }

    if (this.device.changeableValues!.coolSetpoint > 0) {
      this.CoolingThresholdTemperature = this.toCelsius(this.device.changeableValues!.coolSetpoint);
      this.log.debug(
        `Thermostat: ${this.accessory.displayName} parseStatus` +
          ` CoolingThresholdTemperature: ${this.toCelsius(this.device.changeableValues!.coolSetpoint)}`,
      );
    }

    this.TargetHeatingCoolingState = this.modes[this.device.changeableValues!.mode];
    this.log.debug(
      `Thermostat: ${this.accessory.displayName} parseStatus` + ` TargetHeatingCoolingState: ${this.modes[this.device.changeableValues!.mode]}`,
    );

    /**
     * The CurrentHeatingCoolingState is either 'Heat', 'Cool', or 'Off'
     * CurrentHeatingCoolingState =  OFF = 0, HEAT = 1, COOL = 2
     */
    switch (this.device.operationStatus!.mode) {
      case 'Heat':
        this.CurrentHeatingCoolingState = 1;
        this.log.debug(
          `Thermostat: ${this.accessory.displayName}` +
            ` parseStatus Currently Mode (HEAT): ${this.device.operationStatus!.mode}(${this.CurrentHeatingCoolingState})`,
        );
        break;
      case 'Cool':
        this.CurrentHeatingCoolingState = 2;
        this.log.debug(
          `Thermostat: ${this.accessory.displayName}` +
            ` parseStatus Currently Mode (COOL): ${this.device.operationStatus!.mode}(${this.CurrentHeatingCoolingState})`,
        );
        break;
      default:
        this.CurrentHeatingCoolingState = 0;
        this.log.debug(
          `Thermostat: ${this.accessory.displayName}` +
            ` parseStatus Currently Mode (OFF): ${this.device.operationStatus!.mode}(${this.CurrentHeatingCoolingState})`,
        );
    }

    // Set the TargetTemperature value based on the current mode
    if (this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
      if (this.device.changeableValues!.heatSetpoint > 0) {
        this.TargetTemperature = this.toCelsius(this.device.changeableValues!.heatSetpoint);
        this.log.debug(
          `Thermostat: ${this.accessory.displayName}` +
            ` parseStatus TargetTemperature (HEAT): ${this.toCelsius(this.device.changeableValues!.heatSetpoint)})`,
        );
      }
    } else {
      if (this.device.changeableValues!.coolSetpoint > 0) {
        this.TargetTemperature = this.toCelsius(this.device.changeableValues!.coolSetpoint);
        this.log.debug(
          `Thermostat: ${this.accessory.displayName}` +
            ` parseStatus TargetTemperature (OFF/COOL): ${this.toCelsius(this.device.changeableValues!.coolSetpoint)})`,
        );
      }
    }

    // Set the Target Fan State
    if (this.device.settings?.fan && !this.device.thermostat?.hide_fan) {
      if (this.fanMode) {
        this.log.debug(`Thermostat: ${this.accessory.displayName} Fan: ${JSON.stringify(this.fanMode)}`);
        if (this.fanMode.mode === 'Auto') {
          this.TargetFanState = this.platform.Characteristic.TargetFanState.AUTO;
          this.Active = this.platform.Characteristic.Active.INACTIVE;
        } else if (this.fanMode.mode === 'On') {
          this.TargetFanState = this.platform.Characteristic.TargetFanState.MANUAL;
          this.Active = this.platform.Characteristic.Active.ACTIVE;
        } else if (this.fanMode.mode === 'Circulate') {
          this.TargetFanState = this.platform.Characteristic.TargetFanState.MANUAL;
          this.Active = this.platform.Characteristic.Active.INACTIVE;
        }
      }
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
<<<<<<< Updated upstream
      const device: any = (
        await this.platform.axios.get(`${settings.DeviceURL}/thermostats/${this.device.deviceID}`, {
=======
      const { body, statusCode, headers } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
        query: {
          locationId: this.locationId,
        },
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      this.log.debug(`body: ${JSON.stringify(body)}`);
      this.log.debug(`statusCode: ${statusCode}`);
      this.log.debug(`headers: ${JSON.stringify(headers)}`);
      const device: any = await body.json();
      this.log.debug(`Location: ${JSON.stringify(device)}`);
      this.log.debug(`Location StatusCode: ${device.statusCode}`);
      /*const device: any = (
        await this.platform.axios.get(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
>>>>>>> Stashed changes
          params: {
            locationId: this.locationId,
          },
        })
      ).data;*/
      this.device = device;
      this.log.debug(`Thermostat: ${this.accessory.displayName} device: ${JSON.stringify(this.device)}`);
      this.log.debug(`Thermostat: ${this.accessory.displayName} refreshStatus for ${this.device.name}
       from Resideo API: ${JSON.stringify(this.device.changeableValues)}`);
      await this.refreshRoomPriority();
      if (this.device.settings?.fan && !device.thermostat?.hide_fan) {
<<<<<<< Updated upstream
        const fanMode: any = (
          await this.platform.axios.get(`${settings.DeviceURL}/thermostats/${this.device.deviceID}/fan`, {
=======

        const { body, statusCode, headers } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}/fan`, {
          query: {
            locationId: this.locationId,
          },
          method: 'GET',
          headers: { 'content-type': 'application/json' },
        });
        this.log.debug(`body: ${JSON.stringify(body)}`);
        this.log.debug(`statusCode: ${statusCode}`);
        this.log.debug(`headers: ${JSON.stringify(headers)}`);
        const fanMode: any = await body.json();
        this.log.debug(`Fan Mode: ${JSON.stringify(fanMode)}`);
        this.log.debug(`Fan Mode StatusCode: ${fanMode.statusCode}`);

        /*const fanMode: any = (
          await this.platform.axios.get(`${DeviceURL}/thermostats/${this.device.deviceID}/fan`, {
>>>>>>> Stashed changes
            params: {
              locationId: this.locationId,
            },
          })
        ).data;*/
        this.fanMode = fanMode;
        this.log.debug(`Thermostat: ${this.accessory.displayName} fanMode: ${JSON.stringify(this.fanMode)}`);
        this.log.debug(`Thermostat: ${this.accessory.displayName} refreshStatus for ${this.device.name} Fan
        from Resideo Fan API: ${JSON.stringify(this.fanMode)}`);
      }
      this.pushChangesthermostatSetpointStatus();
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.action = 'refreshStatus';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  async refreshRoomPriority(): Promise<void> {
    if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat' && this.device.deviceModel === 'T9-T10') {
<<<<<<< Updated upstream
      this.roompriority = (
        await this.platform.axios.get(`${settings.DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
=======
      const { body, statusCode, headers } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
        query: {
          locationId: this.locationId,
        },
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      this.log.debug(`body: ${JSON.stringify(body)}`);
      this.log.debug(`statusCode: ${statusCode}`);
      this.log.debug(`headers: ${JSON.stringify(headers)}`);
      const roompriority: any = await body.json();
      this.log.debug(`Location: ${JSON.stringify(roompriority)}`);
      this.log.debug(`Location StatusCode: ${roompriority.statusCode}`);
      /*this.roompriority = (
        await this.platform.axios.get(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
>>>>>>> Stashed changes
          params: {
            locationId: this.locationId,
          },
        })
      ).data;*/
      this.log.debug(`Thermostat: ${this.accessory.displayName} Priority: ${JSON.stringify(this.roompriority.data)}`);
    }
  }

  /**
   * Pushes the requested changes to the Resideo API
   */
  async pushChanges(): Promise<void> {
    try {
      const payload = {} as settings.payload;

      // Only include mode on certain models
      switch (this.device.deviceModel) {
        case 'Unknown':
          this.log.debug(`Thermostat: ${this.accessory.displayName} didn't send TargetHeatingCoolingState,` + ` Model:  ${this.device.deviceModel}`);
          break;
        default:
          payload.mode = this.resideoMode[Number(this.TargetHeatingCoolingState)];
          this.log.debug(
            `Thermostat: ${this.accessory.displayName} send TargetHeatingCoolingState` +
              ` mode: ${this.resideoMode[Number(this.TargetHeatingCoolingState)]}`,
          );
      }

      // Only include thermostatSetpointStatus on certain models
      switch (this.device.deviceModel) {
        case 'Round':
          this.log.debug(`Thermostat: ${this.accessory.displayName} didn't send thermostatSetpointStatus,` + ` Model: ${this.device.deviceModel}`);
          break;
        default:
          this.pushChangesthermostatSetpointStatus();
          payload.thermostatSetpointStatus = this.thermostatSetpointStatus;
          if (this.thermostatSetpointStatus === 'TemporaryHold') {
            this.log.warn(
              `Thermostat: ${this.accessory.displayName} send thermostatSetpointStatus: ` +
                `${payload.thermostatSetpointStatus}, Model: ${this.device.deviceModel}`,
            );
          } else {
            this.log.debug(
              `Thermostat: ${this.accessory.displayName} send thermostatSetpointStatus: ` +
                `${payload.thermostatSetpointStatus}, Model: ${this.device.deviceModel}`,
            );
          }
      }

      switch (this.device.deviceModel) {
        case 'Round':
        case 'D6':
          if (this.deviceLogging.includes('debug')) {
            this.log.warn(`Thermostat: ${this.accessory.displayName} set autoChangeoverActive, Model: ${this.device.deviceModel}`);
          }
          // for Round  the 'Auto' feature is enabled via the special mode so only flip this bit when
          // the heating/cooling state is set to  `Auto
          if (this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
            payload.autoChangeoverActive = true;
            this.log.debug(
              `Thermostat: ${this.accessory.displayName} Heating/Cooling state set to Auto for` +
                ` Model: ${this.device.deviceModel}, Force autoChangeoverActive: ${payload.autoChangeoverActive}`,
            );
          } else {
            payload.autoChangeoverActive = this.device.changeableValues?.autoChangeoverActive;
            this.log.debug(
              `Thermostat: ${this.accessory.displayName} Heating/cooling state not set to Auto for` +
                ` Model: ${this.device.deviceModel}, Using device setting` +
                ` autoChangeoverActive: ${this.device.changeableValues!.autoChangeoverActive}`,
            );
          }
          break;
        case 'Unknown':
          this.log.debug(`Thermostat: ${this.accessory.displayName} do not send autoChangeoverActive,` + ` Model: ${this.device.deviceModel}`);
          break;
        default:
          payload.autoChangeoverActive = this.device.changeableValues!.autoChangeoverActive;
          this.log.debug(
            `Thermostat: ${this.accessory.displayName} set autoChangeoverActive to ` +
              `${this.device.changeableValues!.autoChangeoverActive} for Model: ${this.device.deviceModel}`,
          );
      }

      switch (this.device.deviceModel) {
        case 'Unknown':
          this.log.error(JSON.stringify(this.device));
          payload.thermostatSetpoint = this.toFahrenheit(Number(this.TargetTemperature));
          switch (this.device.units) {
            case 'Fahrenheit':
              payload.unit = 'Fahrenheit';
              break;
            case 'Celsius':
              payload.unit = 'Celsius';
              break;
          }
          this.log.info(
            `Thermostat: ${this.accessory.displayName} sent request to Resideo API thermostatSetpoint:` +
              ` ${payload.thermostatSetpoint}, unit: ${payload.unit}`,
          );

          break;
        default:
          // Set the heat and cool set point value based on the selected mode
          switch (this.TargetHeatingCoolingState) {
            case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
              payload.heatSetpoint = this.toFahrenheit(Number(this.TargetTemperature));
              payload.coolSetpoint = this.toFahrenheit(Number(this.CoolingThresholdTemperature));
              this.log.debug(
                `Thermostat: ${this.accessory.displayName} TargetHeatingCoolingState (HEAT): ${this.TargetHeatingCoolingState},` +
                  ` TargetTemperature: ${this.toFahrenheit(Number(this.TargetTemperature))} heatSetpoint,` +
                  ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.CoolingThresholdTemperature))} coolSetpoint`,
              );
              break;
            case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
              payload.coolSetpoint = this.toFahrenheit(Number(this.TargetTemperature));
              payload.heatSetpoint = this.toFahrenheit(Number(this.HeatingThresholdTemperature));
              this.log.debug(
                `Thermostat: ${this.accessory.displayName} TargetHeatingCoolingState (COOL): ${this.TargetHeatingCoolingState},` +
                  ` TargetTemperature: ${this.toFahrenheit(Number(this.TargetTemperature))} coolSetpoint,` +
                  ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.HeatingThresholdTemperature))} heatSetpoint`,
              );
              break;
            case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
              payload.coolSetpoint = this.toFahrenheit(Number(this.CoolingThresholdTemperature));
              payload.heatSetpoint = this.toFahrenheit(Number(this.HeatingThresholdTemperature));
              this.log.debug(
                `Thermostat: ${this.accessory.displayName} TargetHeatingCoolingState (AUTO): ${this.TargetHeatingCoolingState},` +
                  ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.CoolingThresholdTemperature))} coolSetpoint,` +
                  ` HeatingThresholdTemperature: ${this.toFahrenheit(Number(this.HeatingThresholdTemperature))} heatSetpoint`,
              );
              break;
            default:
              payload.coolSetpoint = this.toFahrenheit(Number(this.CoolingThresholdTemperature));
              payload.heatSetpoint = this.toFahrenheit(Number(this.HeatingThresholdTemperature));
              this.log.debug(
                `Thermostat: ${this.accessory.displayName} TargetHeatingCoolingState (OFF): ${this.TargetHeatingCoolingState},` +
                  ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.CoolingThresholdTemperature))} coolSetpoint,` +
                  ` HeatingThresholdTemperature: ${this.toFahrenheit(Number(this.HeatingThresholdTemperature))} heatSetpoint`,
              );
          }
          this.log.info(`Room Sensor Thermostat: ${this.accessory.displayName} set request (${JSON.stringify(payload)}) to Resideo API.`);
      }

      // Attempt to make the API request
<<<<<<< Updated upstream
      await this.platform.axios.post(`${settings.DeviceURL}/thermostats/${this.device.deviceID}`, payload, {
=======
      const { body, statusCode, headers } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
        query: {
          locationId: this.locationId,
        },
        body: JSON.stringify(payload),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      this.log.debug(`body: ${JSON.stringify(body)}`);
      this.log.debug(`statusCode: ${statusCode}`);
      this.log.debug(`headers: ${JSON.stringify(headers)}`);
      const pushChanges: any = await body.json();
      this.log.debug(`Location: ${JSON.stringify(pushChanges)}`);
      this.log.debug(`Location StatusCode: ${pushChanges.statusCode}`);
      /*await this.platform.axios.post(`${DeviceURL}/thermostats/${this.device.deviceID}`, payload, {
>>>>>>> Stashed changes
        params: {
          locationId: this.locationId,
        },
      });*/
      this.log.debug(`Thermostat: ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`);
    } catch (e: any) {
      this.action = 'pushChanges';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  async pushChangesthermostatSetpointStatus(): Promise<void> {
    if (this.thermostatSetpointStatus) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} thermostatSetpointStatus config set to ` + `${this.thermostatSetpointStatus}`);
    } else {
      this.thermostatSetpointStatus = 'PermanentHold';
      this.accessory.context.thermostatSetpointStatus = this.thermostatSetpointStatus;
      this.log.debug(`Thermostat: ${this.accessory.displayName} thermostatSetpointStatus config not set`);
    }
  }

  /**
   * Pushes the requested changes for Room Priority to the Resideo API
   */
  async pushRoomChanges(): Promise<void> {
    this.log.debug(`Thermostat Room Priority for ${this.accessory.displayName}
     Current Room: ${JSON.stringify(this.roompriority.currentPriority.selectedRooms)},
     Changing Room: [${this.device.inBuiltSensorState!.roomId}]`);
    if (`[${this.device.inBuiltSensorState!.roomId}]` !== `[${this.roompriority.currentPriority.selectedRooms}]`) {
      const payload = {
        currentPriority: {
          priorityType: this.device.thermostat?.roompriority?.priorityType,
        },
      } as any;

      if (this.device.thermostat?.roompriority?.priorityType === 'PickARoom') {
        payload.currentPriority.selectedRooms = [this.device.inBuiltSensorState!.roomId];
      }

      /**
       * For "LCC-" devices only.
       * "NoHold" will return to schedule.
       * "TemporaryHold" will hold the set temperature until next schedule.
       * "PermanentHold" will hold the setpoint until user requests another change.
       */
      if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
        if (this.device.priorityType === 'FollowMe') {
          this.log.info(
            `Sending request for ${this.accessory.displayName} to Resideo API Priority Type:` +
              ` ${this.device.priorityType}, Built-in Occupancy Sensor(s) Will be used to set Priority Automatically`,
          );
        } else if (this.device.priorityType === 'WholeHouse') {
          this.log.info(`Sending request for ${this.accessory.displayName} to Resideo API Priority Type:` + ` ${this.device.priorityType}`);
        } else if (this.device.priorityType === 'PickARoom') {
          this.log.info(
            `Sending request for ${this.accessory.displayName} to Resideo API Room Priority:` +
              ` ${this.device.inBuiltSensorState!.roomName}, Priority Type: ${this.device.thermostat?.roompriority.priorityType}`,
          );
        }
        // Make the API request
<<<<<<< Updated upstream
        await this.platform.axios.put(`${settings.DeviceURL}/thermostats/${this.device.deviceID}/priority`, payload, {
=======
        const { body, statusCode, headers } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
          query: {
            locationId: this.locationId,
          },
          body: JSON.stringify(payload),
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
        });
        this.log.debug(`body: ${JSON.stringify(body)}`);
        this.log.debug(`statusCode: ${statusCode}`);
        this.log.debug(`headers: ${JSON.stringify(headers)}`);
        const pushRoomChanges: any = await body.json();
        this.log.debug(`Location: ${JSON.stringify(pushRoomChanges)}`);
        this.log.debug(`Location StatusCode: ${pushRoomChanges.statusCode}`);
        /*await this.platform.axios.put(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, payload, {
>>>>>>> Stashed changes
          params: {
            locationId: this.locationId,
          },
        });*/
        this.log.debug(`Thermostat: ${this.accessory.displayName} pushRoomChanges: ${JSON.stringify(payload)}`);
      }
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.TemperatureDisplayUnits === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} TemperatureDisplayUnits: ${this.TemperatureDisplayUnits}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
      this.debugLog(`Thermostat: ${this.accessory.displayName} updateCharacteristic TemperatureDisplayUnits: ${this.TemperatureDisplayUnits}`);
=======
      this.service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
      this.log.debug(`Thermostat: ${this.accessory.displayName} updateCharacteristic TemperatureDisplayUnits: ${this.TemperatureDisplayUnits}`);
>>>>>>> Stashed changes
    }
    if (this.CurrentTemperature === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} CurrentTemperature: ${this.CurrentTemperature}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.CurrentTemperature);
      this.debugLog(`Thermostat: ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.CurrentTemperature}`);
=======
      this.service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.CurrentTemperature);
      this.log.debug(`Thermostat: ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.CurrentTemperature}`);
>>>>>>> Stashed changes
    }
    if (!this.device.indoorHumidity || this.device.thermostat?.hide_humidity || this.CurrentRelativeHumidity === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
    } else {
<<<<<<< Updated upstream
      this.humidityService!.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      this.debugLog(`Thermostat: ${this.accessory.displayName} updateCharacteristic CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
=======
      this.humidityService!.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      this.log.debug(`Thermostat: ${this.accessory.displayName} updateCharacteristic CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
>>>>>>> Stashed changes
    }
    if (this.TargetTemperature === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} TargetTemperature: ${this.TargetTemperature}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.TargetTemperature);
      this.debugLog(`Thermostat: ${this.accessory.displayName} updateCharacteristic TargetTemperature: ${this.TargetTemperature}`);
=======
      this.service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.TargetTemperature);
      this.log.debug(`Thermostat: ${this.accessory.displayName} updateCharacteristic TargetTemperature: ${this.TargetTemperature}`);
>>>>>>> Stashed changes
    }
    if (this.HeatingThresholdTemperature === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} HeatingThresholdTemperature: ${this.HeatingThresholdTemperature}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.HeatingThresholdTemperature);
      this.debugLog(
=======
      this.service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, this.HeatingThresholdTemperature);
      this.log.debug(
>>>>>>> Stashed changes
        `Thermostat: ${this.accessory.displayName} updateCharacteristic` + ` HeatingThresholdTemperature: ${this.HeatingThresholdTemperature}`,
      );
    }
    if (this.CoolingThresholdTemperature === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} CoolingThresholdTemperature: ${this.CoolingThresholdTemperature}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.CoolingThresholdTemperature);
      this.debugLog(
=======
      this.service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, this.CoolingThresholdTemperature);
      this.log.debug(
>>>>>>> Stashed changes
        `Thermostat: ${this.accessory.displayName} updateCharacteristic` + ` CoolingThresholdTemperature: ${this.CoolingThresholdTemperature}`,
      );
    }
    if (this.TargetHeatingCoolingState === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} TargetHeatingCoolingState: ${this.TargetHeatingCoolingState}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.TargetHeatingCoolingState);
      this.debugLog(
=======
      this.service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, this.TargetHeatingCoolingState);
      this.log.debug(
>>>>>>> Stashed changes
        `Thermostat: ${this.accessory.displayName} updateCharacteristic` + ` TargetHeatingCoolingState: ${this.TargetHeatingCoolingState}`,
      );
    }
    if (this.CurrentHeatingCoolingState === undefined) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} CurrentHeatingCoolingState: ${this.CurrentHeatingCoolingState}`);
    } else {
<<<<<<< Updated upstream
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);
      this.debugLog(
=======
      this.service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);
      this.log.debug(
>>>>>>> Stashed changes
        `Thermostat: ${this.accessory.displayName} updateCharacteristic` + ` CurrentHeatingCoolingState: ${this.TargetHeatingCoolingState}`,
      );
    }
    if (this.device.settings?.fan && !this.device.thermostat?.hide_fan) {
      if (this.TargetFanState === undefined) {
        this.log.debug(`Thermostat Fan: ${this.accessory.displayName} TargetFanState: ${this.TargetFanState}`);
      } else {
<<<<<<< Updated upstream
        this.fanService?.updateCharacteristic(this.platform.Characteristic.TargetFanState, this.TargetFanState);
        this.debugLog(`Thermostat Fan: ${this.accessory.displayName} updateCharacteristic TargetFanState: ${this.TargetFanState}`);
=======
        this.fanService?.updateCharacteristic(this.hap.Characteristic.TargetFanState, this.TargetFanState);
        this.log.debug(`Thermostat Fan: ${this.accessory.displayName} updateCharacteristic TargetFanState: ${this.TargetFanState}`);
>>>>>>> Stashed changes
      }
      if (this.Active === undefined) {
        this.log.debug(`Thermostat Fan: ${this.accessory.displayName} Active: ${this.Active}`);
      } else {
<<<<<<< Updated upstream
        this.fanService?.updateCharacteristic(this.platform.Characteristic.Active, this.Active);
        this.debugLog(`Thermostat Fan: ${this.accessory.displayName} updateCharacteristic Active: ${this.Active}`);
=======
        this.fanService?.updateCharacteristic(this.hap.Characteristic.Active, this.Active);
        this.log.debug(`Thermostat Fan: ${this.accessory.displayName} updateCharacteristic Active: ${this.Active}`);
>>>>>>> Stashed changes
      }
    }
  }

  async apiError(e: any): Promise<void> {
    this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, e);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, e);
    if (this.device.indoorHumidity && !this.device.thermostat?.hide_humidity) {
      this.humidityService!.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, e);
    }
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, e);
    this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, e);
    this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, e);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, e);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, e);
    if (this.device.settings?.fan && !this.device.thermostat?.hide_fan) {
      this.fanService?.updateCharacteristic(this.platform.Characteristic.TargetFanState, e);
      this.fanService?.updateCharacteristic(this.platform.Characteristic.Active, e);
    }
    //throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  async resideoAPIError(e: any): Promise<void> {
    if (this.device.retry) {
      if (this.action === 'pushChanges') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.pushChanges();
          });
      } else if (this.action === 'refreshRoomPriority') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshRoomPriority();
          });
      } else if (this.action === 'pushRoomChanges') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.pushRoomChanges();
          });
      } else if (this.action === 'pushFanChanges') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.pushFanChanges();
          });
      } else if (this.action === 'refreshStatus') {
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      }
    }
    if (e.message.includes('400')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Bad Request`);
      this.log.debug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Unauthorized Request`);
      this.log.debug('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Forbidden Request`);
      this.log.debug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Requst Not Found`);
      this.log.debug('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Request Not Acceptable`);
      this.log.debug('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Unsupported Requst Header`);
      this.log.debug('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Unprocessable Entity`);
      this.log.debug(
        'The client has made a valid request, but the server cannot process it.' +
          ' This is often used for APIs for which certain limits have been exceeded.',
      );
    } else if (e.message.includes('429')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Too Many Requests`);
      this.log.debug('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action}, Internal Server Error`);
      this.log.debug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to ${this.action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.log.error(`Thermostat: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`);
    }
  }

  async statusCode(statusCode: number): Promise<void> {
    /**
    * Meater API Status Codes (https://github.com/apption-labs/meater-cloud-public-rest-api)
    *
    * Standard Response Codes: 200(OK), 201(Created), 204(No Content)
    * https://github.com/apption-labs/meater-cloud-public-rest-api#standard-response
    *
    * Error Response: 400(Bad Request), 401(Unauthorized), 404(Not Found), 429(Too Many Requests), 500(Internal Server Error)
    * https://github.com/apption-labs/meater-cloud-public-rest-api#error-response
    **/
    switch (statusCode) {
      case 200:
        this.log.debug(`${this.accessory.displayName} Standard Response, statusCode: ${statusCode}`);
        break;
      case 400:
        this.log.error(`${this.accessory.displayName} Bad Request, statusCode: ${statusCode}`);
        break;
      case 401:
        this.log.error(`${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}`);
        break;
      case 404:
        this.log.error(`${this.accessory.displayName} Not Found, statusCode: ${statusCode}`);
        break;
      case 429:
        this.log.error(`${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}`);
        break;
      case 500:
        this.log.error(`${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}`);
        break;
      default:
        this.log.info(
          `${this.accessory.displayName} Unknown statusCode: ${statusCode}, Report Bugs Here: https://bit.ly/homebridge-meater-bug-report`);
    }
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set TargetHeatingCoolingState: ${value}`);

    this.TargetHeatingCoolingState = value;

    // Set the TargetTemperature value based on the selected mode
    if (this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
      this.TargetTemperature = this.toCelsius(this.device.changeableValues!.heatSetpoint);
    } else {
      this.TargetTemperature = this.toCelsius(this.device.changeableValues!.coolSetpoint);
    }
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.TargetTemperature);
    if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat' && this.device.deviceModel === 'T9-T10') {
      this.doRoomUpdate.next();
    }
    if (this.TargetHeatingCoolingState !== this.modes[this.device.changeableValues!.mode]) {
      this.doThermostatUpdate.next();
    }
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set HeatingThresholdTemperature: ${value}`);
    this.HeatingThresholdTemperature = value;
    this.doThermostatUpdate.next();
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set CoolingThresholdTemperature: ${value}`);
    this.CoolingThresholdTemperature = value;
    this.doThermostatUpdate.next();
  }

  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set TargetTemperature: ${value}`);
    this.TargetTemperature = value;
    this.doThermostatUpdate.next();
  }

  async setTemperatureDisplayUnits(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set TemperatureDisplayUnits: ${value}`);
    this.log.warn('Changing the Hardware Display Units from HomeKit is not supported.');

    // change the temp units back to the one the Resideo API said the thermostat was set to
    setTimeout(() => {
      this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
    }, 100);
  }

  /**
   * Handle requests to get the current value of the "Programmable Switch Event" characteristic
   */
  handleProgrammableSwitchEventGet() {
    this.log.debug('Triggered GET ProgrammableSwitchEvent');

    // set this to a valid value for ProgrammableSwitchEvent
    const currentValue = this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;

    return currentValue;
  }


  /**
   * Handle requests to get the current value of the "Programmable Switch Output State" characteristic
   */
  handleProgrammableSwitchOutputStateGet() {
    this.log.debug('Triggered GET ProgrammableSwitchOutputState');

    // set this to a valid value for ProgrammableSwitchOutputState
    const currentValue = 1;

    return currentValue;
  }

  /**
   * Handle requests to set the "Programmable Switch Output State" characteristic
   */
  handleProgrammableSwitchOutputStateSet(value) {
    this.log.debug('Triggered SET ProgrammableSwitchOutputState:', value);
  }

  /**
   * Converts the value to celsius if the temperature units are in Fahrenheit
   */
  toCelsius(value: number): number {
    if (this.TemperatureDisplayUnits === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) {
      return value;
    }

    // celsius should be to the nearest 0.5 degree
    return Math.round((5 / 9) * (value - 32) * 2) / 2;
  }

  /**
   * Converts the value to fahrenheit if the temperature units are in Fahrenheit
   */
  toFahrenheit(value: number): number {
    if (this.TemperatureDisplayUnits === this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) {
      return value;
    }

    return Math.round((value * 9) / 5 + 32);
  }

  /**
   * Pushes the requested changes for Fan to the Resideo API
   */
  async pushFanChanges(): Promise<void> {
    let payload = {
      mode: 'Auto', // default to Auto
    };
    if (this.device.settings?.fan && !this.device.thermostat?.hide_fan) {
      this.log.debug(`Thermostat: ${this.accessory.displayName} TargetFanState: ${this.TargetFanState}, Active: ${this.Active}`);

      if (this.TargetFanState === this.platform.Characteristic.TargetFanState.AUTO) {
        payload = {
          mode: 'Auto',
        };
      } else if (
        this.TargetFanState === this.platform.Characteristic.TargetFanState.MANUAL &&
        this.Active === this.platform.Characteristic.Active.ACTIVE
      ) {
        payload = {
          mode: 'On',
        };
      } else if (
        this.TargetFanState === this.platform.Characteristic.TargetFanState.MANUAL &&
        this.Active === this.platform.Characteristic.Active.INACTIVE
      ) {
        payload = {
          mode: 'Circulate',
        };
      }

      this.log.info(`Sending request for ${this.accessory.displayName} to Resideo API Fan Mode: ${payload.mode}`);
      // Make the API request
<<<<<<< Updated upstream
      await this.platform.axios.post(`${settings.DeviceURL}/thermostats/${this.device.deviceID}/fan`, payload, {
=======
      const { body, statusCode, headers } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}/fan`, {
        query: {
          locationId: this.locationId,
        },
        body: JSON.stringify(payload),
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
      });
      this.log.debug(`body: ${JSON.stringify(body)}`);
      this.log.debug(`statusCode: ${statusCode}`);
      this.log.debug(`headers: ${JSON.stringify(headers)}`);
      const pushRoomChanges: any = await body.json();
      this.log.debug(`Location: ${JSON.stringify(pushRoomChanges)}`);
      this.log.debug(`Location StatusCode: ${pushRoomChanges.statusCode}`);
      /*await this.platform.axios.post(`${DeviceURL}/thermostats/${this.device.deviceID}/fan`, payload, {
>>>>>>> Stashed changes
        params: {
          locationId: this.locationId,
        },
      });*/
      this.log.debug(`Thermostat: ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async setActive(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set Active: ${value}`);
    this.Active = value;
    this.doFanUpdate.next();
  }

  async setTargetFanState(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Thermostat: ${this.accessory.displayName} Set TargetFanState: ${value}`);
    this.TargetFanState = value;
    this.doFanUpdate.next();
  }

  TargetState(): number[] {
    this.log.debug(`Thermostat: ${this.accessory.displayName} allowedModes: ${this.device.allowedModes}`);

    const TargetState = [4];
    TargetState.pop();
    if (this.device.allowedModes?.includes('Cool')) {
      TargetState.push(this.platform.Characteristic.TargetHeatingCoolingState.COOL);
    }
    if (this.device.allowedModes?.includes('Heat')) {
      TargetState.push(this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
    }
    if (this.device.allowedModes?.includes('Off')) {
      TargetState.push(this.platform.Characteristic.TargetHeatingCoolingState.OFF);
    }
    if (this.device.allowedModes?.includes('Auto') || this.device.thermostat?.show_auto) {
      TargetState.push(this.platform.Characteristic.TargetHeatingCoolingState.AUTO);
    }
    this.log.debug(`Thermostat: ${this.accessory.displayName} Only Show These Modes: ${JSON.stringify(TargetState)}`);
    return TargetState;
  }
<<<<<<< Updated upstream

  async config(device: settings.device & settings.devicesConfig): Promise<void> {
    let config = {};
    if (device.thermostat) {
      config = device.thermostat;
    }
    if (device.logging !== undefined) {
      config['logging'] = device.logging;
    }
    if (device.refreshRate !== undefined) {
      config['refreshRate'] = device.refreshRate;
    }
    if (Object.entries(config).length !== 0) {
      this.infoLog(`Thermostat: ${this.accessory.displayName} Config: ${superStringify(config)}`);
    }
  }

  async refreshRate(device: settings.device & settings.devicesConfig): Promise<void> {
    if (device.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.platform.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.platform.config.options!.refreshRate;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  async logs(device: settings.device & settings.devicesConfig): Promise<void> {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugLog(`Thermostat: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
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

  debugWarnLog({ log = [] }: { log?: any[] } = {}): void {
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
      if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
=======
>>>>>>> Stashed changes
}
