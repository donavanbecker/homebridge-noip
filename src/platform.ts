import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, NoIPPlatformConfig } from './settings';
import publicIp from 'public-ip';
import { ContactSensor } from './devices/contactsensor';

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

  debugMode!: boolean;
  device!: string;
  version = require('../package.json').version // eslint-disable-line @typescript-eslint/no-var-requires

  constructor(public readonly log: Logger, public readonly config: NoIPPlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
    }

    // HOOBS notice
    if (__dirname.includes('hoobs')) {
      this.log.warn('This plugin has not been tested under HOOBS, it is highly recommended that ' +
        'you switch to Homebridge: https://git.io/Jtxb0');
    }

    // verify the config
    try {
      this.verifyConfig();
      this.log.debug('Config OK');
    } catch (e) {
      this.log.error(JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }

    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        this.discoverDevices();
      } catch (e) {
        this.log.error('Failed to Discover Devices.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

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
    this.config.disablePlugin;
    this.config.hide_device;


    if (this.config.refreshRate! < 1800) {
      throw new Error('Refresh Rate must be above 1800 (30 minutes).');
    }

    if (this.config.disablePlugin) {
      this.log.error('Plugin is disabled.');
    }

    if (!this.config.refreshRate) {
      // default 900 seconds (15 minutes)
      this.config.refreshRate! = 1800;
      this.log.warn('Using Default Refresh Rate of 30 minutes.');
    }

    if (!this.config.hostname) {
      throw new Error('Missing Domain, Need Domain that will be updated.');
    }
    if (!this.config.username) {
      throw new Error('Missing Your No-IP Username(E-mail)');
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
    this.log.info('Discovered %s', this.config.hostname);
    this.createContactSensor(device);
  }

  private async createContactSensor(device) {
    const uuid = this.api.hap.uuid.generate(device);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (
        !this.config.disablePlugin
      ) {
        this.log.info(
          'Restoring existing accessory from cache:',
          existingAccessory.displayName,
        );

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        existingAccessory.context.serialNumber = (await publicIp.v4()) || '127.0.0.1';
        this.log.debug(await publicIp.v4());
        existingAccessory.context.model = 'DUC';
        existingAccessory.context.firmwareRevision = this.version;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new ContactSensor(this, existingAccessory, device);
        this.log.debug(`UDID: ${device}`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (
      !this.config.disablePlugin
    ) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(
        'Adding new accessory:',
        device,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(device, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.serialNumber = (await publicIp.v4()) || '127.0.0.1';
      this.log.debug(await publicIp.v4());
      accessory.context.model = 'DUC';
      accessory.context.firmwareRevision = this.version;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new ContactSensor(this, accessory, device);
      this.log.debug(`Thermostat UDID: ${device}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (this.config.devicediscovery) {
        this.log.error(
          'Unable to Register new device:',
          device,
        );
        this.log.error('Check Config to see if DeviceID is being Hidden.');
      }
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.warn('Removing existing accessory from cache:', existingAccessory.displayName);
  }
}
