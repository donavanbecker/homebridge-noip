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

  constructor(public readonly log: Logger, public readonly config: NoIPPlatformConfig, public readonly api: API) {
    this.logs();
    this.debugLog(`Finished initializing platform: ${this.config.name}`);
    // only load if configured
    if (!this.config) {
      return;
    }

    // HOOBS notice
    if (__dirname.includes('hoobs')) {
      this.warnLog('This plugin has not been tested under HOOBS, it is highly recommended that you switch to Homebridge: https://git.io/Jtxb0');
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

  logs() {
    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
    if (this.debugMode && !this.config.logging) {
      if (this.debugMode) {
        this.log.warn('Using debugMode Logging');
      }
      this.Logging = 'debugMode';
    } else if (this.config.logging === 'debug' || this.config.logging === 'standard' || this.config.logging === 'none') {
      this.Logging = this.config.logging;
      if (this.debugMode) {
        this.log.warn(`Using Config Logging: ${this.Logging}`);
      }
    } else {
      this.log.info('Using Standard Logging');
      this.Logging = 'standard';
    }
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
  verifyConfig() {
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

    if (!this.config.hostname) {
      throw new Error('Missing Domain, Need Domain that will be updated.');
    }
    if (!this.config.username) {
      throw new Error('Missing Your No-IP Username(E-mail)');
    } else if (!this.validateEmail(this.config.username)) {
      throw Error('Provide a valid Email');
    }
    if (!this.config.password) {
      throw new Error('Missing your No-IP Password');
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  async discoverDevices() {
    const device = this.config.hostname;
    this.infoLog(`Discovered ${this.config.hostname}`);
    this.createContactSensor(device);
  }

  private async createContactSensor(device: any) {
    const uuid = this.api.hap.uuid.generate(device);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.disablePlugin) {
        this.infoLog(`Restoring existing accessory from cache: ${existingAccessory.displayName}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.displayName = device;
        existingAccessory.context.device = device;
        existingAccessory.context.serialNumber = await this.publicIPv4();
        this.debugLog(JSON.stringify(existingAccessory.context.serialNumber));
        existingAccessory.context.model = 'DUC';
        existingAccessory.context.firmwareRevision = await this.FirmwareRevision(device);
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new ContactSensor(this, existingAccessory, device);
        this.debugLog(`uuid: ${device}`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.disablePlugin) {
      // the accessory does not yet exist, so we need to create it
      this.infoLog(`Adding new accessory: ${device}`);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.serialNumber = await this.publicIPv4();
      this.debugLog(JSON.stringify(accessory.context.serialNumber));
      accessory.context.model = 'DUC';
      accessory.context.firmwareRevision = await this.FirmwareRevision(device);
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new ContactSensor(this, accessory, device);
      this.debugLog(`uuid: ${device}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (this.config.debug === 'device') {
        this.errorLog(`Unable to Register new device: ${device}`);
        this.errorLog(`Check Config, Plugin Disabled: ${this.config.disablePlugin}`);
      }
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
    const { body, statusCode, headers } = await request('https://ipinfo.io/json', {
      method: 'GET',
    });
    const pubIp = await body.json();
    this.warnLog(`Devices: ${JSON.stringify(pubIp.body)}`);
    this.warnLog(`Status Code: ${JSON.stringify(statusCode)}`);
    this.warnLog(`Headers: ${JSON.stringify(headers)}`);
    //const pubIp = (await axios.get('https://ipinfo.io/json')).data;
    //this.debugLog(JSON.stringify(pubIp));
    const IPv4 = pubIp.ip;
    return IPv4;
  }

  generateHeaders = async () => {
    return {
      'Authorization': `${this.config.username}:${this.config.password}`,
      'User-Agent': `Homebridge-NoIP/v${this.version}`,
      'params': {
        'hostname': this.config.hostname,
        'myip': await this.publicIPv4(),
      },
    };
  };

  validateEmail(email: string | undefined) {
    const re =
      // eslint-disable-next-line max-len
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  }

  /**
   * If device level logging is turned on, log to log.warn
   * Otherwise send debug logs to log.debug
   */
  infoLog(...log: any[]) {
    if (this.enablingLogging()) {
      this.log.info(String(...log));
    }
  }

  warnLog(...log: any[]) {
    if (this.enablingLogging()) {
      this.log.warn(String(...log));
    }
  }

  errorLog(...log: any[]) {
    if (this.enablingLogging()) {
      this.log.error(String(...log));
    }
  }

  debugLog(...log: any[]) {
    if (this.enablingLogging()) {
      if (this.Logging?.includes('debug')) {
        this.log.debug(String(...log));
        this.log.info('[DEBUG]', String(...log));
      }
    }
  }

  enablingLogging(): boolean {
    return this.Logging?.includes('debug') || this.Logging === 'standard';
  }
}
