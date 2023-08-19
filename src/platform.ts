import { request } from 'undici';
import { ContactSensor } from './devices/contactsensor';
import { PLATFORM_NAME, PLUGIN_NAME, NoIPPlatformConfig } from './settings';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class NoIPPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  version = process.env.npm_package_version || '1.6.0';
  Logging?: string;
  debugMode!: boolean;
  platformLogging?: string;

  constructor(public readonly log: Logger, public readonly config: NoIPPlatformConfig, public readonly api: API) {
    this.logs();
    this.debugLog(`Finished initializing platform: ${this.config.name}`);
    // only load if configured
    if (!this.config) {
      return;
    }

    // verify the config
    try {
      this.verifyConfig();
      this.debugLog('Config OK');
    } catch (e: any) {
      this.errorLog(JSON.stringify(e.message));
      this.debugLog(JSON.stringify(e));
      return;
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        this.discoverDevices();
      } catch (e: any) {
        this.errorLog(`Failed to Discover Devices ${JSON.stringify(e.message)}`);
        this.debugLog(JSON.stringify(e));
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.infoLog(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  async verifyConfig() {
    /**
     * Hidden Device Discovery Option
     * This will disable adding any device and will just output info.
     */
    this.config.debug;

    if (this.config.refreshRate! < 1800) {
      throw new Error('Refresh Rate must be above 1800 (30 minutes).');
    }

    if (!this.config.refreshRate) {
      // default 900 seconds (15 minutes)
      this.config.refreshRate! = 1800;
      this.infoLog('Using Default Refresh Rate of 30 minutes.');
    }
    // Old Config
    if (this.config.hostname || this.config.username || this.config.password) {
      const oldConfig = {
        hostname: this.config.hostname,
        username: this.config.username,
        password: this.config.password,
      };
      this.errorLog(`You still have old config that will be ignored, Old Config: ${JSON.stringify(oldConfig)}`);
    }
    // Device Config
    if (this.config.devices) {
      for (const deviceConfig of this.config.devices) {
        if (!deviceConfig.hostname) {
          this.errorLog('Missing Domain, Need Domain that will be updated.');
        }
        if (!deviceConfig.username) {
          this.errorLog('Missing Your No-IP Username(E-mail)');
        } else if (!this.validateEmail(deviceConfig.username)) {
          this.errorLog('Provide a valid Email');
        }
        if (!deviceConfig.password) {
          this.errorLog('Missing your No-IP Password');
        }
      }
    } else {
      this.errorLog('verifyConfig, No Device Config');
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  async discoverDevices() {
    try {
      for (const device of this.config.devices!) {
        this.infoLog(`Discovered ${device.hostname}`);
        this.createContactSensor(device);
      }
    } catch {
      this.errorLog('discoverDevices, No Device Config');
    }
  }

  private async createContactSensor(device: any) {
    const uuid = this.api.hap.uuid.generate(device.hostname);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!device.delete) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = device.hostname;
        existingAccessory.context.device = device;
        existingAccessory.context.serialNumber = await this.publicIPv4();
        this.debugLog(JSON.stringify(existingAccessory.context.serialNumber));
        existingAccessory.context.model = 'DUC';
        existingAccessory.context.firmwareRevision = await this.FirmwareRevision(device);
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new ContactSensor(this, existingAccessory, device);
        this.debugLog(`uuid: ${device.hostname}`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!device.delete) {
      // the accessory does not yet exist, so we need to create it
      this.infoLog(`Adding new accessory: ${device.hostname}`);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.hostname, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device.hostname;
      accessory.context.serialNumber = await this.publicIPv4();
      this.debugLog(JSON.stringify(accessory.context.serialNumber));
      accessory.context.model = 'DUC';
      accessory.context.firmwareRevision = await this.FirmwareRevision(device);
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new ContactSensor(this, accessory, device);
      this.debugLog(`${device.hostname} uuid: ${device.hostname}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      this.debugErrorLog(`Unable to Register new device: ${JSON.stringify(device.hostname)}`);
    }
  }

  async FirmwareRevision(device: { firmware: any; }): Promise<any> {
    let firmware: any;
    if (device.firmware) {
      firmware = device.firmware;
    } else {
      firmware = this.version;
    }
    return firmware;
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.warnLog(`Removing existing accessory from cache: ${existingAccessory.displayName}`);
  }

  async publicIPv4() {
    try {
      const { body, statusCode, headers } = await request('https://ipinfo.io/json', {
        method: 'GET',
      });
      const pubIp: any = await body.json();
      this.debugWarnLog(`IP Address: ${JSON.stringify(pubIp.ip)}`);
      this.debugWarnLog(`Status Code: ${JSON.stringify(statusCode)}`);
      this.debugWarnLog(`Headers: ${JSON.stringify(headers)}`);
      //const pubIp = (await axios.get('https://ipinfo.io/json')).data;
      //this.debugLog(JSON.stringify(pubIp));
      const IPv4 = pubIp.ip;
      return IPv4;
    } catch {
      this.errorLog('Not Able To Retreive IP Address');
    }
  }

  validateEmail(email: string | undefined) {
    const re =
      // eslint-disable-next-line max-len
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  }

  logs() {
    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
    if (this.config.options?.logging === 'debug' || this.config.options?.logging === 'standard' || this.config.options?.logging === 'none') {
      this.platformLogging = this.config.options!.logging;
      this.debugWarnLog(`Using Config Logging: ${this.platformLogging}`);
    } else if (this.debugMode) {
      this.platformLogging = 'debugMode';
      this.debugWarnLog(`Using ${this.platformLogging} Logging`);
    } else {
      this.platformLogging = 'standard';
      this.debugWarnLog(`Using ${this.platformLogging} Logging`);
    }
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  infoLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.info(String(...log));
    }
  }

  warnLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      this.log.error(String(...log));
    }
  }

  debugErrorLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: any[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log));
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      }
    }
  }

  enablingPlatfromLogging(): boolean {
    return this.platformLogging?.includes('debug') || this.platformLogging === 'standard';
  }
}
