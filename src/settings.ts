/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * settings.ts: homebridge-resideo.
 */
import { PlatformConfig } from 'homebridge';
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'Resideo';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-resideo';

/**
 * This is the main url used to access Resideo API
 */
export const AuthorizeURL = 'https://api.honeywell.com/oauth2/authorize?';

/**
 * This is the main url used to access Resideo API
 */
export const TokenURL = 'https://api.honeywell.com/oauth2/token';

/**
 * This is the main url used to access Resideo API
 */
export const LocationURL = 'https://api.honeywell.com/v2/locations';

/**
 * This is the main url used to access Resideo API
 */
export const DeviceURL = 'https://api.honeywell.com/v2/devices';

//Config
export interface ResideoPlatformConfig extends PlatformConfig {
  credentials?: credentials;
  options?: options | Record<string, never>;
  callbackUrl?: string;
  port?: string;
}

export type credentials = {
  accessToken?: string;
  consumerKey?: string;
  consumerSecret?: string;
  refreshToken?: string;
};

export type options = {
  refreshRate?: number;
  pushRate?: number;
  devices?: Array<devicesConfig>;
  logging?: string;
};

export interface devicesConfig extends resideoDevice {
  deviceClass: string;
  deviceID: string;
  thermostat?: thermostat;
  valve?: valve;
  leaksensor?: leaksensor;
  hide_device?: boolean;
  external?: boolean;
  logging?: string;
  refreshRate?: number;
  retry?: boolean;
  firmware?: string;
}

export type thermostat = {
  show_auto?: boolean;
  hide_fan?: boolean;
  hide_humidity?: boolean;
  thermostatSetpointStatus?: string;
  statefulStatus?: boolean;
  roomsensor?: roomsensor;
  roompriority?: roompriority;
};

export type leaksensor = {
  hide_humidity?: boolean;
  hide_temperature?: boolean;
  hide_leak?: boolean;
};

export type roomsensor = {
  hide_roomsensor?: boolean;
  hide_temperature?: boolean;
  hide_occupancy?: boolean;
  hide_motion?: boolean;
  hide_humidity?: boolean;
  logging?: string;
  refreshRate?: number;
};

export type roompriority = {
  deviceType?: string;
  priorityType?: string;
  logging?: string;
  refreshRate?: number;
};

export type valve = {
  valveType?: number;
};

export type modes = {
  Off: number;
  Heat: number;
  Cool: number;
  Auto: number;
};

export type holdModes = {
  NoHold: number;
  TemporaryHold: number;
  PermanentHold: number;
};

export type payload = {
  mode?: string;
  heatSetpoint: number;
  coolSetpoint: number;
  thermostatSetpointStatus?: string;
  nextPeriodTime?: string;
  autoChangeoverActive?: boolean;
  thermostatSetpoint?: number;
  unit?: string;
  state?: string;
};

export type locations = Array<location>;

// Location
export type location = {
  locationID: number;
  name: string;
  devices: Array<resideoDevice>;
};

export type resideoDevice = {
  groups?: Array<T9groups>;
  inBuiltSensorState?: inBuiltSensorState;
  settings?: Settings;
  deviceClass: string;
  deviceType: string;
  deviceID: string;
  userDefinedDeviceName: string;
  name?: string;
  isAlive: boolean;
  priorityType?: string;
  units?: string;
  indoorTemperature?: number;
  allowedModes?: string[];
  minHeatSetpoint?: number;
  maxHeatSetpoint?: number;
  minCoolSetpoint?: number;
  maxCoolSetpoint?: number;
  changeableValues?: ChangeableValues;
  operationStatus?: OperationStatus;
  indoorHumidity?: number;
  deviceModel: string;
  displayedOutdoorHumidity?: number;
  scheduleStatus?: string;
  allowedTimeIncrements?: number;
  isUpgrading?: boolean;
  isProvisioned?: boolean;
  macID?: string;
  dataSyncStatus?: string;
  outdoorTemperature?: number;
  deadband?: number;
  hasDualSetpointStatus?: boolean;
  thermostatVersion?: string;
  parentDeviceId?: number;
  service: Service;
  deviceSettings: Record<string, unknown>; //DeviceSettings
  firmwareVersion?: string;
  vacationHold?: VacationHold;
  currentSchedulePeriod?: CurrentSchedulePeriod;
  scheduleCapabilities?: ScheduleCapabilities;
  scheduleType?: ScheduleType;
  changeSource?: ChangeSource;
  partnerInfo?: PartnerInfo;
  deviceRegistrationDate?: Date;
  indoorHumidityStatus?: string;
  waterPresent: boolean;
  currentSensorReadings: CurrentSensorReadings;
  batteryRemaining: number;
  isRegistered: boolean;
  hasDeviceCheckedIn: boolean;
  isDeviceOffline: boolean;
  deviceMac: string	//Device MAC address
  dataSyncInfo: dataSyncInfo;
  lastCheckin: Date;	//Last time data received from device
  actuatorValve: actuatorValve;	//Values specific to the valve operation
  daylightSavingsInfo: daylightSavingsInfo	//Daylight savings time config info
  maintenance: maintenance	//Maintenance settings
};

export type T9groups = {
  id: number;
};

export type inBuiltSensorState = {
  roomId: number;
  roomName: string;
};

// Fan Settings
export type Settings = {
  homeSetPoints?: HomeSetPoints;
  awaySetPoints?: AwaySetPoints;
  fan: Fan;
  temperatureMode?: TemperatureMode;
  specialMode?: SpecialMode;
  hardwareSettings?: HardwareSettings;
  devicePairingEnabled?: boolean;
};

export type ChangeableValues = {
  mode: string;
  autoChangeoverActive?: boolean;
  heatSetpoint: number;
  coolSetpoint: number;
  thermostatSetpointStatus?: string;
  nextPeriodTime?: string;
  endHeatSetpoint?: number;
  endCoolSetpoint?: number;
  heatCoolMode: string;
  emergencyHeatActive?: boolean;
};

export type OperationStatus = {
  mode: string;
  fanRequest?: boolean;
  circulationFanRequest?: boolean;
};

export type Service = {
  mode: string;
};

export type AwaySetPoints = {
  awayHeatSP: number;
  awayCoolSP: number;
  smartCoolSP: number;
  smartHeatSP: number;
  useAutoSmart: boolean;
  units: string;
};

export type HomeSetPoints = {
  homeHeatSP: number;
  homeCoolSP: number;
  units: string;
};

export type TemperatureMode = {
  feelsLike?: boolean;
  air: boolean;
};

export type SpecialMode = {
  autoChangeoverActive: boolean;
  emergencyHeatActive?: boolean;
};

export type Fan = {
  allowedModes: string[];
  changeableValues: FanChangeableValues;
  fanRunning: boolean;
  allowedSpeeds?: AllowedSpeed[];
};

export type FanChangeableValues = {
  mode: string;
};

export type AllowedSpeed = {
  item: string;
  value: Value;
};

export type Value = {
  speed?: number;
  mode: string;
};

export type VacationHold = {
  enabled: boolean;
};

export type CurrentSchedulePeriod = {
  day: string;
  period: string;
};

export type ScheduleCapabilities = {
  availableScheduleTypes: string[];
  schedulableFan: boolean;
};

export type ScheduleType = {
  scheduleType: string;
  scheduleSubType: string;
};

export type ChangeSource = {
  by: string;
  name: string;
};

export type HardwareSettings = {
  brightness: number;
  maxBrightness: number;
};

export type PartnerInfo = {
  singleOrMultiODUConfiguration: number;
  parentDeviceModelId: number;
  parentDeviceBrandId: number;
  oduName: string;
};

export type DeviceSettings = {
  temp: Temp;
  humidity: Humidity;
  userDefinedName: string;
  buzzerMuted: boolean;
  checkinPeriod: number;
  currentSensorReadPeriod: number;
};

export type Humidity = {
  high: Record<string, unknown>;
  low: Record<string, unknown>;
};

export type CurrentSensorReadings = {
  temperature: number;
  humidity: number;
};

export type Temp = {
  high: Record<string, unknown>;
  low: Record<string, unknown>;
};

// T9 Room Sensors
export type sensorAccessory = {
  accessoryId: number;
  accessoryAttribute: accessoryAttribute;
  accessoryValue: accessoryValue;
  roomId: number;
  deviceID: string;
};

export type accessoryAttribute = {
  type: string;
  connectionMethod: string;
  name: string;
  model: string;
  serialNumber: string;
  softwareRevision: string;
  hardwareRevision: string;
};

export type accessoryValue = {
  coolSetpoint: number;
  heatSetpoint: number;
  indoorHumidity: number;
  indoorTemperature: number;
  motionDet: boolean;
  occupancyDet: boolean;
  excludeTemp: boolean;
  excludeMotion: boolean;
  pressure: number;
  occupancyTimeout: number;
  status: string;
  batteryStatus: string;
  rssiAverage: number;
  occupancySensitivity: string;
};

// T9 Room Priority
export type Priority = {
  deviceId: string;
  status: string;
  currentPriority: CurrentPriority;
};

export type CurrentPriority = {
  priorityType: string;
  selectedRooms: Record<string, unknown>;
  rooms: PriorityRooms[];
};

export type PriorityRooms = {
  rooms: PriorityRoom;
};

export type PriorityRoom = {
  id: number;
  roomName: string;
  roomAvgTemp: number;
  roomAvgHumidity: number;
  overallMotion: boolean;
  accessories: Accessory[];
};

export type Accessory = {
  id: number;
  type: string;
  excludeTemp: boolean;
  excludeMotion: boolean;
  temperature: number;
  status: string;
  detectMotion: boolean;
};

export type dataSyncInfo = {
  state: string; //'NotStarted' | 'Initiated' | 'Completed' | 'Failed'
  transactionId: string;	//Internal reference ID for the DataSync operation
}

export type actuatorValve = {
  commandSource: string;//'app' | 'wldFreeze' | 'wldLeak' | 'manual' | 'buildInLeak' | 'maintenance';
  runningTime: number;	//Operation time
  valveStatus: string //'unknown' | 'open' | 'close' | 'notOpen' | 'notClose' | 'opening' | 'closing' | 'antiScaleOpening' | 'antiScaleClosing';
  motorCycles: number;	//Count of motor operations
  motorCurrentAverage: number;
  motorCurrentMax: number;
  deviceTemperature: number;	//Current temperature of device in Fahrenheit units
  lastAntiScaleTime: Date;	//Last time of anti - scale operation
  leakStatus: string; //'ok' | 'leak' | 'na' | 'err'
  timeValveChanged: Date;	//Time of last valve change
}

export type daylightSavingsInfo = {
  isDaylightSaving: boolean	//If device is currently using DST or not
  nextOffsetChange: Date	//Next scheduled DST changeover
}

export type maintenance = {
  antiScaleSettings: string;	//Current anti - scale cycle: 'OncePerWeek' | 'OncePerTwoWeeks' | 'OncePerMonth' | 'OncePerTwoMonths' | 'Disabled'
  antiScaleDOWSettings: string;	//'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'
  antiScaleDOMSettings: number;	//If monthly anti - scale is used, day of the month.
  antiScaleTimeSettings: string;	//Time for anti - scale in 24 hrs format
}
