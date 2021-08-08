import { Service, PlatformAccessory, HAPStatus, CharacteristicValue } from 'homebridge';
import { NoIPPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { skipWhile } from 'rxjs/operators';
import { HTTP, location, LeakDevice } from '../settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ContactSensor {
  private service: Service;

  ContactSensorState!: CharacteristicValue;

  SensorUpdateInProgress!: boolean;
  doSensorUpdate;

  constructor(
    private readonly platform: NoIPPlatform,
    private accessory: PlatformAccessory,
    public device,
  ) {
    // default placeholders
    this.ContactSensorState;

    // this is subject we use to track when we need to POST changes to the Honeywell API
    this.doSensorUpdate = new Subject();
    this.SensorUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Honeywell')
      .setCharacteristic(this.platform.Characteristic.Model, device.deviceType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.deviceID)
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

    // Do initial device parse
    this.parseStatus();

    // Set Charging State
    this.service.setCharacteristic(this.platform.Characteristic.ContactSensorState, 2);

    // Retrieve initial values and updateHomekit
    this.refreshStatus();
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });
  }

  /**
   * Parse the device status from the honeywell api
   */
  parseStatus() {
    // Set Sensor State
    switch (this.device.isAlive) {
      case true:
        this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
        break;
      default:
        this.ContactSensorState = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    }

    this.platform.log.debug(
      'CS %s - %s°, %s%',
      this.accessory.displayName,
      this.ContactSensorState,
    );
  }

  /**
   * Asks the Honeywell Home API for the latest device information
   */
  async refreshStatus() {
    try {
      this.device = (
        await this.platform.axios.get(`${HTTP}/waterLeakDetectors/${this.device.deviceID}`, {
        })
      ).data;
      this.platform.log.debug('CS %s - ', this.accessory.displayName, JSON.stringify(this.device));
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e) {
      this.platform.log.error(
        'CS - Failed to update status of',
        this.device.userDefinedDeviceName,
        JSON.stringify(e.message),
        this.platform.log.debug('CS %s - ', this.accessory.displayName, JSON.stringify(e)),
      );
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
    throw new this.platform.api.hap.HapStatusError(HAPStatus.OPERATION_TIMED_OUT);
  }
}
