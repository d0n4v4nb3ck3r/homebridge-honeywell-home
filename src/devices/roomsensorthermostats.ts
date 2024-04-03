/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * roomsensorthermostats.ts: homebridge-resideo.
 */
import { request } from 'undici';
import { interval, Subject } from 'rxjs';
import { ResideoPlatform } from '../platform.js';
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators';
import { Service, PlatformAccessory, CharacteristicValue, API, HAP, Logging } from 'homebridge';
import {
  FanChangeableValues, devicesConfig, modes, resideoDevice, sensorAccessory, T9groups, location, DeviceURL, payload, ResideoPlatformConfig,
} from '../settings.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RoomSensorThermostat {
  public readonly api: API;
  public readonly log: Logging;
  public readonly config!: ResideoPlatformConfig;
  protected readonly hap: HAP;
  // Services
  service: Service;

  // CharacteristicValue
  TargetTemperature!: CharacteristicValue;
  CurrentTemperature!: CharacteristicValue;
  CurrentRelativeHumidity!: CharacteristicValue;
  TemperatureDisplayUnits!: CharacteristicValue;
  TargetHeatingCoolingState!: CharacteristicValue;
  CurrentHeatingCoolingState!: CharacteristicValue;
  CoolingThresholdTemperature!: CharacteristicValue;
  HeatingThresholdTemperature!: CharacteristicValue;

  // Others
  modes: modes;
  action!: string;
  roompriority: any;
  resideoMode!: Array<string>;
  deviceFan!: FanChangeableValues;

  // Config
  deviceLogging!: string;
  deviceRefreshRate!: number;

  // Thermostat Update
  thermostatUpdateInProgress!: boolean;
  doThermostatUpdate!: Subject<void>;

  // Room Updates
  roomUpdateInProgress!: boolean;
  doRoomUpdate!: Subject<void>;

  // Fan Updates
  fanUpdateInProgress!: boolean;
  doFanUpdate!: Subject<void>;

  constructor(
    private readonly platform: ResideoPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly locationId: location['locationID'],
    public device: resideoDevice & devicesConfig,
    public sensorAccessory: sensorAccessory,
    public readonly group: T9groups,
  ) {
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.config = this.platform.config;
    this.hap = this.api.hap;

    this.TargetTemperature = this.accessory.context.TargetTemperature || 20;
    this.CurrentTemperature = this.accessory.context.CurrentTemperature || 20;
    this.CurrentRelativeHumidity = this.accessory.context.CurrentRelativeHumidity || 50;
    this.TemperatureDisplayUnits = this.accessory.context.TemperatureDisplayUnits || this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS;
    this.TargetHeatingCoolingState = this.accessory.context.TargetHeatingCoolingState || this.hap.Characteristic.TargetHeatingCoolingState.AUTO;
    this.CurrentHeatingCoolingState = this.accessory.context.CurrentHeatingCoolingState || this.hap.Characteristic.CurrentHeatingCoolingState.OFF;
    this.CoolingThresholdTemperature = this.accessory.context.CoolingThresholdTemperature || 20;
    this.HeatingThresholdTemperature = this.accessory.context.HeatingThresholdTemperature || 22;
    accessory.context.FirmwareRevision = 'v2.0.0';

    this.deviceLogging = this.device.logging || this.config.options?.logging || 'standard';

    // Map Resideo Modes to HomeKit Modes
    this.modes = {
      Off: this.hap.Characteristic.TargetHeatingCoolingState.OFF,
      Heat: this.hap.Characteristic.TargetHeatingCoolingState.HEAT,
      Cool: this.hap.Characteristic.TargetHeatingCoolingState.COOL,
      Auto: this.hap.Characteristic.TargetHeatingCoolingState.AUTO,
    };

    // Map HomeKit Modes to Resideo Modes
    // Don't change the order of these!
    this.resideoMode = ['Off', 'Heat', 'Cool', 'Auto'];

    // default placeholders
    this.CurrentTemperature;
    this.TargetTemperature;
    this.CurrentHeatingCoolingState;
    this.TargetHeatingCoolingState;
    this.CoolingThresholdTemperature;
    this.HeatingThresholdTemperature;
    this.CurrentRelativeHumidity;
    this.TemperatureDisplayUnits;

    // this is subject we use to track when we need to POST changes to the Resideo API
    this.doRoomUpdate = new Subject();
    this.roomUpdateInProgress = false;
    this.doThermostatUpdate = new Subject();
    this.thermostatUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(this.hap.Characteristic.Model, sensorAccessory.accessoryAttribute.model || '1100')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, sensorAccessory.deviceID)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, accessory.context.firmwareRevision || 'v2.0.0');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    (this.service = this.accessory.getService(this.hap.Service.Thermostat) || this.accessory.addService(this.hap.Service.Thermostat)),
    `${accessory.displayName} Thermostat`;

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.hap.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.hap.Characteristic.Name, `${accessory.displayName} Thermostat`);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Thermostat

    // Do initial device parse
    this.parseStatus();

    // Set Min and Max
    if (device.changeableValues!.heatCoolMode === 'Heat') {
      this.log.debug(`Room Sensor Thermostat: ${accessory.displayName} mode: ${device.changeableValues!.heatCoolMode}`);
      this.service
        .getCharacteristic(this.hap.Characteristic.TargetTemperature)
        .setProps({
          minValue: this.toCelsius(device.minHeatSetpoint!),
          maxValue: this.toCelsius(device.maxHeatSetpoint!),
          minStep: 0.5,
        })
        .onGet(() => {
          return this.TargetTemperature;
        });
    } else {
      this.log.debug(`Room Sensor Thermostat: ${accessory.displayName} mode: ${device.changeableValues!.heatCoolMode}`);
      this.service
        .getCharacteristic(this.hap.Characteristic.TargetTemperature)
        .setProps({
          minValue: this.toCelsius(device.minCoolSetpoint!),
          maxValue: this.toCelsius(device.maxCoolSetpoint!),
          minStep: 0.5,
        })
        .onGet(() => {
          return this.TargetTemperature;
        });
    }

    // The value property of TargetHeaterCoolerState must be one of the following:
    //AUTO = 3; HEAT = 1; COOL = 2; OFF = 0;
    // Set control bindings
    const TargetState = this.TargetState();
    this.service
      .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: TargetState,
      })
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service.setCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);

    this.service.getCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature).onSet(this.setHeatingThresholdTemperature.bind(this));

    this.service.getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature).onSet(this.setCoolingThresholdTemperature.bind(this));

    this.service.getCharacteristic(this.hap.Characteristic.TargetTemperature).onSet(this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits).onSet(this.setTemperatureDisplayUnits.bind(this));

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.thermostatUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
        await this.refreshSensorStatus();
      });

    // Watch for thermostat change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    if (device.thermostat?.roompriority?.deviceType === 'Thermostat') {
      this.doRoomUpdate
        .pipe(
          tap(() => {
            this.roomUpdateInProgress = true;
          }),
          debounceTime(this.config.options!.pushRate! * 500),
        )
        .subscribe(async () => {
          try {
            await this.refreshRoomPriority();
          } catch (e: any) {
            this.action = 'refreshRoomPriority';
            this.resideoAPIError(e);
            this.apiError(e);
          }
          try {
            await this.pushRoomChanges();
          } catch (e: any) {
            this.action = 'pushRoomChanges';
            this.resideoAPIError(e);
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
        debounceTime(this.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges();
        } catch (e: any) {
          this.action = 'pushChanges';
          this.resideoAPIError(e);
          this.apiError(e);
        }
        this.thermostatUpdateInProgress = false;
        // Refresh the status from the API
        interval(5000)
          .pipe(skipWhile(() => this.thermostatUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
      });
  }

  /**
   * Parse the device status from the Resideo api
   */
  async parseStatus(): Promise<void> {
    if (this.device.units === 'Fahrenheit') {
      this.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    }
    if (this.device.units === 'Celsius') {
      this.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    this.CurrentTemperature = this.toCelsius(this.sensorAccessory.accessoryValue.indoorTemperature);
    this.CurrentRelativeHumidity = this.sensorAccessory.accessoryValue.indoorHumidity;

    if (this.device.changeableValues!.heatSetpoint > 0) {
      this.HeatingThresholdTemperature = this.toCelsius(this.device.changeableValues!.heatSetpoint);
    }

    if (this.device.changeableValues!.coolSetpoint > 0) {
      this.CoolingThresholdTemperature = this.toCelsius(this.device.changeableValues!.coolSetpoint);
    }

    this.TargetHeatingCoolingState = this.modes[this.device.changeableValues!.mode];

    /**
     * The CurrentHeatingCoolingState is either 'Heat', 'Cool', or 'Off'
     * CurrentHeatingCoolingState =  OFF = 0, HEAT = 1, COOL = 2
     */
    switch (this.device.operationStatus!.mode) {
      case 'Heat':
        this.CurrentHeatingCoolingState = 1;
        break;
      case 'Cool':
        this.CurrentHeatingCoolingState = 2;
        break;
      default:
        this.CurrentHeatingCoolingState = 0;
    }
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} CurrentHeatingCoolingState: ${this.CurrentHeatingCoolingState}`);

    // Set the TargetTemperature value based on the current mode
    if (this.TargetHeatingCoolingState === this.hap.Characteristic.TargetHeatingCoolingState.HEAT) {
      if (this.device.changeableValues!.heatSetpoint > 0) {
        this.TargetTemperature = this.toCelsius(this.device.changeableValues!.heatSetpoint);
      }
    } else {
      if (this.device.changeableValues!.coolSetpoint > 0) {
        this.TargetTemperature = this.toCelsius(this.device.changeableValues!.coolSetpoint);
      }
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    try {
      const { body, statusCode } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
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
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} device: ${JSON.stringify(device)}`);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName}` +
        ` Fetched update for: ${this.device.name} from Resideo API: ${JSON.stringify(this.device.changeableValues)}`,
      );

      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.action = 'refreshStatus';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  /**
   * Asks the Resideo Home API for the latest device information
   */
  async refreshSensorStatus(): Promise<void> {
    try {
      if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
        if (this.device.deviceID.startsWith('LCC')) {
          if (this.device.deviceModel.startsWith('T9')) {
            if (this.device.groups) {
              const groups = this.device.groups;
              for (const group of groups) {
                const roomsensors = await this.platform.getCurrentSensorData(this.device, group, this.locationId);
                if (roomsensors.rooms) {
                  const rooms = roomsensors.rooms;
                  this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} roomsensors: ${JSON.stringify(roomsensors)}`);
                  for (const accessories of rooms) {
                    if (accessories) {
                      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} accessories: ${JSON.stringify(accessories)}`);
                      for (const accessory of accessories.accessories) {
                        if (accessory.accessoryAttribute) {
                          if (accessory.accessoryAttribute.type) {
                            if (accessory.accessoryAttribute.type.startsWith('IndoorAirSensor')) {
                              this.sensorAccessory = accessory;
                              this.log.debug(
                                `Room Sensor Thermostat: ${this.accessory.displayName}` +
                                ` accessoryAttribute: ${JSON.stringify(this.sensorAccessory.accessoryAttribute)}`,
                              );
                              this.log.debug(
                                `Room Sensor Thermostat: ${this.accessory.displayName}` +
                                ` Name: ${this.sensorAccessory.accessoryAttribute.name},` +
                                ` Software Version: ${this.sensorAccessory.accessoryAttribute.softwareRevision}`,
                              );
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
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.action = 'refreshSensorStatus';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  async refreshRoomPriority(): Promise<void> {
    if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
      const { body, statusCode } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
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
      const action = 'refreshRoomPriority';
      await this.statusCode(statusCode, action);
      const roompriority: any = await body.json();
      this.log.debug(`(refreshRoomPriority) roompriority: ${JSON.stringify(roompriority)}`);
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} roompriority: ${JSON.stringify(this.roompriority)}`);
    }
  }

  /**
   * Pushes the requested changes for Room Priority to the Resideo API
   */
  async pushRoomChanges(): Promise<void> {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Room Priority,
     Current Room: ${JSON.stringify(this.roompriority.currentPriority.selectedRooms)}, Changing Room: [${this.sensorAccessory.accessoryId}]`);
    if (`[${this.sensorAccessory.accessoryId}]` !== `[${this.roompriority.currentPriority.selectedRooms}]`) {
      const payload = {
        currentPriority: {
          priorityType: this.device.thermostat?.roompriority?.priorityType,
        },
      } as any;

      if (this.device.thermostat?.roompriority?.priorityType === 'PickARoom') {
        payload.currentPriority.selectedRooms = [this.sensorAccessory.accessoryId];
      }

      /**
       * For "LCC-" devices only.
       * "NoHold" will return to schedule.
       * "TemporaryHold" will hold the set temperature until "nextPeriodTime".
       * "PermanentHold" will hold the setpoint until user requests another change.
       */
      if (this.device.thermostat?.roompriority?.deviceType === 'Thermostat') {
        if (this.device.thermostat?.roompriority.priorityType === 'FollowMe') {
          this.log.info(
            `Room Sensor Thermostat: ${this.accessory.displayName} sent request to Resideo API, Priority Type: ` +
            `${this.device.thermostat?.roompriority.priorityType} Built-in Occupancy Sensor(s) Will be used to set Priority Automatically.`,
          );
        } else if (this.device.thermostat?.roompriority.priorityType === 'WholeHouse') {
          this.log.info(
            `Room Sensor Thermostat: ${this.accessory.displayName} sent request to Resideo API,` +
            ` Priority Type: ${this.device.thermostat?.roompriority.priorityType}`,
          );
        } else if (this.device.thermostat?.roompriority.priorityType === 'PickARoom') {
          this.log.info(
            `Room Sensor Thermostat: ${this.accessory.displayName} sent request to Resideo API,` +
            ` Room Priority: ${this.sensorAccessory.accessoryAttribute.name}, Priority Type: ${this.device.thermostat?.roompriority.priorityType}`,
          );
        }

        // Make the API request
        const { body, statusCode } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}/priority`, {
          method: 'PUT',
          body: JSON.stringify(payload),
          query: {
            'locationId': this.locationId,
            'apikey': this.config.credentials?.consumerKey,
          },
          headers: {
            'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        const action = 'pushRoomChanges';
        await this.statusCode(statusCode, action);
        this.log.debug(`(pushRoomChanges) body: ${JSON.stringify(body)}`);
        this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} pushRoomChanges: ${JSON.stringify(payload)}`);
      }
      // Refresh the status from the API
      await this.refreshSensorStatus();
    }
  }

  /**
   * Pushes the requested changes to the Resideo API
   */
  async pushChanges(): Promise<void> {
    try {
      const payload = {
        mode: this.resideoMode[Number(this.TargetHeatingCoolingState)],
        thermostatSetpointStatus: this.device.thermostat?.thermostatSetpointStatus,
        autoChangeoverActive: this.device.changeableValues!.autoChangeoverActive,
      } as payload;

      // Set the heat and cool set point value based on the selected mode
      switch (this.TargetHeatingCoolingState) {
        case this.hap.Characteristic.TargetHeatingCoolingState.HEAT:
          payload.heatSetpoint = this.toFahrenheit(Number(this.TargetTemperature));
          payload.coolSetpoint = this.toFahrenheit(Number(this.CoolingThresholdTemperature));
          this.log.debug(
            `Room Sensor Thermostat: ${this.accessory.displayName}` +
            ` TargetHeatingCoolingState (HEAT): ${this.TargetHeatingCoolingState},` +
            ` TargetTemperature: ${this.toFahrenheit(Number(this.TargetTemperature))} heatSetpoint,` +
            ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.CoolingThresholdTemperature))} coolSetpoint`,
          );
          break;
        case this.hap.Characteristic.TargetHeatingCoolingState.COOL:
          payload.coolSetpoint = this.toFahrenheit(Number(this.TargetTemperature));
          payload.heatSetpoint = this.toFahrenheit(Number(this.HeatingThresholdTemperature));
          this.log.debug(
            `Room Sensor Thermostat: ${this.accessory.displayName}` +
            ` TargetHeatingCoolingState (COOL): ${this.TargetHeatingCoolingState},` +
            ` TargetTemperature: ${this.toFahrenheit(Number(this.TargetTemperature))} coolSetpoint,` +
            ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.HeatingThresholdTemperature))} heatSetpoint`,
          );
          break;
        case this.hap.Characteristic.TargetHeatingCoolingState.AUTO:
          payload.coolSetpoint = this.toFahrenheit(Number(this.CoolingThresholdTemperature));
          payload.heatSetpoint = this.toFahrenheit(Number(this.HeatingThresholdTemperature));
          this.log.debug(
            `Room Sensor Thermostat: ${this.accessory.displayName}` +
            ` TargetHeatingCoolingState (AUTO): ${this.TargetHeatingCoolingState},` +
            ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.CoolingThresholdTemperature))} coolSetpoint,` +
            ` HeatingThresholdTemperature: ${this.toFahrenheit(Number(this.HeatingThresholdTemperature))} heatSetpoint`,
          );
          break;
        default:
          payload.coolSetpoint = this.toFahrenheit(Number(this.CoolingThresholdTemperature));
          payload.heatSetpoint = this.toFahrenheit(Number(this.HeatingThresholdTemperature));
          this.log.debug(
            `Room Sensor Thermostat: ${this.accessory.displayName}` +
            ` TargetHeatingCoolingState (OFF): ${this.TargetHeatingCoolingState},` +
            ` CoolingThresholdTemperature: ${this.toFahrenheit(Number(this.CoolingThresholdTemperature))} coolSetpoint,` +
            ` HeatingThresholdTemperature: ${this.toFahrenheit(Number(this.HeatingThresholdTemperature))} heatSetpoint`,
          );
      }
      this.log.info(`Room Sensor Thermostat: ${this.accessory.displayName} set request (${JSON.stringify(payload)}) to Resideo API.`);

      // Make the API request
      const { statusCode } = await request(`${DeviceURL}/thermostats/${this.device.deviceID}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        query: {
          'locationId': this.locationId,
          'apikey': this.config.credentials?.consumerKey,
        },
        headers: {
          'Authorization': `Bearer ${this.config.credentials?.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const action = 'pushChanges';
      await this.statusCode(statusCode, action);
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} pushChanges: ${JSON.stringify(payload)}`);
    } catch (e: any) {
      this.action = 'pushChanges';
      this.resideoAPIError(e);
      this.apiError(e);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    if (this.TemperatureDisplayUnits === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} TemperatureDisplayUnits: ${this.TemperatureDisplayUnits}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName}` + ` updateCharacteristic TemperatureDisplayUnits: ${this.TemperatureDisplayUnits}`,
      );
    }
    if (this.CurrentTemperature === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} CurrentTemperature: ${this.CurrentTemperature}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.CurrentTemperature);
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} updateCharacteristic CurrentTemperature: ${this.CurrentTemperature}`);
    }
    if (this.CurrentRelativeHumidity === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName}` + ` updateCharacteristic CurrentRelativeHumidity: ${this.CurrentRelativeHumidity}`,
      );
    }
    if (this.TargetTemperature === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} TargetTemperature: ${this.TargetTemperature}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.TargetTemperature);
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} updateCharacteristic TargetTemperature: ${this.TargetTemperature}`);
    }
    if (this.HeatingThresholdTemperature === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} HeatingThresholdTemperature: ${this.HeatingThresholdTemperature}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, this.HeatingThresholdTemperature);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName} updateCharacteristic` +
        ` HeatingThresholdTemperature: ${this.HeatingThresholdTemperature}`,
      );
    }
    if (this.CoolingThresholdTemperature === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} CoolingThresholdTemperature: ${this.CoolingThresholdTemperature}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, this.CoolingThresholdTemperature);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName} updateCharacteristic` +
        ` CoolingThresholdTemperature: ${this.CoolingThresholdTemperature}`,
      );
    }
    if (this.TargetHeatingCoolingState === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} TargetHeatingCoolingState: ${this.TargetHeatingCoolingState}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, this.TargetHeatingCoolingState);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName} updateCharacteristic` +
        ` TargetHeatingCoolingState: ${this.TargetHeatingCoolingState}`,
      );
    }
    if (this.CurrentHeatingCoolingState === undefined) {
      this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} CurrentHeatingCoolingState: ${this.CurrentHeatingCoolingState}`);
    } else {
      this.service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);
      this.log.debug(
        `Room Sensor Thermostat: ${this.accessory.displayName} updateCharacteristic` +
        ` CurrentHeatingCoolingState: ${this.TargetHeatingCoolingState}`,
      );
    }
  }

  async apiError(e: any): Promise<void> {
    this.service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, e);
    this.service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e);
    this.service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, e);
    this.service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, e);
    this.service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, e);
    this.service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, e);
    this.service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, e);
    this.service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, e);
    //throw new this.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Bad Request`);
      this.log.debug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.');
    } else if (e.message.includes('401')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Unauthorized Request`);
      this.log.debug('Authorization for the API is required, but the request has not been authenticated.');
    } else if (e.message.includes('403')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Forbidden Request`);
      this.log.debug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.');
    } else if (e.message.includes('404')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Requst Not Found`);
      this.log.debug('Specifies the requested path does not exist.');
    } else if (e.message.includes('406')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Request Not Acceptable`);
      this.log.debug('The client has requested a MIME type via the Accept header for a value not supported by the server.');
    } else if (e.message.includes('415')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Unsupported Requst Header`);
      this.log.debug('The client has defined a contentType header that is not supported by the server.');
    } else if (e.message.includes('422')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Unprocessable Entity`);
      this.log.debug(
        'The client has made a valid request, but the server cannot process it.' +
        ' This is often used for APIs for which certain limits have been exceeded.',
      );
    } else if (e.message.includes('429')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Too Many Requests`);
      this.log.debug('The client has exceeded the number of requests allowed for a given time window.');
    } else if (e.message.includes('500')) {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action}, Internal Server Error`);
      this.log.debug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.');
    } else {
      this.log.error(`Room Sensor Thermostat: ${this.accessory.displayName} failed to ${this.action},`);
    }
    if (this.deviceLogging.includes('debug')) {
      this.log.error(
        `Room Sensor Thermostat: ${this.accessory.displayName} failed to pushChanges, ` + `Error Message: ${JSON.stringify(e.message)}`,
      );
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

  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Set TargetHeatingCoolingState: ${value}`);

    this.TargetHeatingCoolingState = value;

    // Set the TargetTemperature value based on the selected mode
    if (this.TargetHeatingCoolingState === this.hap.Characteristic.TargetHeatingCoolingState.HEAT) {
      this.TargetTemperature = this.toCelsius(this.device.changeableValues!.heatSetpoint);
    } else {
      this.TargetTemperature = this.toCelsius(this.device.changeableValues!.coolSetpoint);
    }
    this.service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.TargetTemperature);
    if (this.TargetHeatingCoolingState !== this.modes[this.device.changeableValues!.mode]) {
      this.doRoomUpdate.next();
      this.doThermostatUpdate.next();
    }
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Set HeatingThresholdTemperature: ${value}`);
    this.HeatingThresholdTemperature = value;
    this.doThermostatUpdate.next();
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Set CoolingThresholdTemperature: ${value}`);
    this.CoolingThresholdTemperature = value;
    this.doThermostatUpdate.next();
  }

  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Set TargetTemperature: ${value}`);
    this.TargetTemperature = value;
    this.doThermostatUpdate.next();
  }

  async setTemperatureDisplayUnits(value: CharacteristicValue): Promise<void> {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Set TemperatureDisplayUnits: ${value}`);
    this.log.warn('Changing the Hardware Display Units from HomeKit is not supported.');

    // change the temp units back to the one the Resideo API said the thermostat was set to
    setTimeout(() => {
      this.service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
    }, 100);
  }

  /**
   * Converts the value to celsius if the temperature units are in Fahrenheit
   */
  toCelsius(value: number): number {
    if (this.TemperatureDisplayUnits === this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS) {
      return value;
    }

    // celsius should be to the nearest 0.5 degree
    return Math.round((5 / 9) * (value - 32) * 2) / 2;
  }

  /**
   * Converts the value to fahrenheit if the temperature units are in Fahrenheit
   */
  toFahrenheit(value: number): number {
    if (this.TemperatureDisplayUnits === this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS) {
      return value;
    }

    return Math.round((value * 9) / 5 + 32);
  }

  TargetState(): number[] {
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} allowedModes: ${this.device.allowedModes}`);

    const TargetState = [4];
    TargetState.pop();
    if (this.device.allowedModes!.includes('Cool')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.COOL);
    }
    if (this.device.allowedModes!.includes('Heat')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.HEAT);
    }
    if (this.device.allowedModes!.includes('Off')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.OFF);
    }
    if (this.device.allowedModes!.includes('Auto')) {
      TargetState.push(this.hap.Characteristic.TargetHeatingCoolingState.AUTO);
    }
    this.log.debug(`Room Sensor Thermostat: ${this.accessory.displayName} Only Show These Modes: ${JSON.stringify(TargetState)}`);
    return TargetState;
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
}
