import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { NoIPPlatform } from '../platform';
import { interval } from 'rxjs';
import { skipWhile } from 'rxjs/operators';
import NoIP from 'no-ip';
//import { HTTP } from '../settings';
//import os from 'os';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ContactSensor {
  private service: Service;

  ContactSensorState!: CharacteristicValue;
  noip: any;

  SensorUpdateInProgress!: boolean;

  constructor(
    private readonly platform: NoIPPlatform,
    private accessory: PlatformAccessory,
    public device,
  ) {
    // default placeholders
    this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    this.noip = new NoIP({
      hostname: this.platform.config.hostname,
      user: this.platform.config.username,
      pass: this.platform.config.password,
    });

    // this is subject we use to track when we need to POST changes to the NoIP API
    this.SensorUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'No-IP')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.firmwareRevision)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.firmwareRevision);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    (this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor)), accessory.displayName;

    // To avoid "Cannot add a Service with the same UUID another Service without aCSo defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/

    // Retrieve initial values and updateHomekit
    this.refreshStatus();
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.refreshRate! * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the noip api
   */
  parseStatus() {
    this.platform.debug(`${this.accessory.displayName} - ${this.ContactSensorState}`);
  }

  /**
   * Asks the NoIP API for the latest device information
   */
  async refreshStatus() {
    try {
      this.noip.on('error', (err: string) => {
        this.platform.log.error(err);
        this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      });
      this.noip.on('success', (isChanged: boolean, ip: any) => {
        this.platform.debug(`IP: ${ip}`);
        this.platform.debug(`Has IP Changed: ${isChanged}`);
        this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(this.ContactSensorState);
      });
      this.noip.update();
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.platform.log.error(
        'Failed to update status of',
        this.accessory.displayName,
        JSON.stringify(e.message),
      );
      this.platform.debug(`${this.accessory.displayName} - ${JSON.stringify(e)}`);
      this.apiError(e);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.ContactSensorState !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.ContactSensorState);
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, e);
  }
}
