import { PlatformConfig } from 'homebridge';
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'NoIP';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-noip';

/**
 * This is the main url used to access honeywell API
 */
export const updateDomain = 'dynupdate.no-ip.com/nic/update';

//Config
export interface NoIPPlatformConfig extends PlatformConfig {
  domain?: string[];
  username?: string;
  password?: string;
  refreshRate?: number;
  pushRate?: number;
  hide_device?: string;
  debug?: boolean;
  disablePlugin?: boolean;
}

export interface AxiosRequestConfig {
  params?: Record<string, unknown>;
  headers?: any;
}