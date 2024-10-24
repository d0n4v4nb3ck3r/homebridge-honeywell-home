<span align="center">

<a href="https://github.com/homebridge/verified/blob/latest/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-resideo/latest/branding/Homebridge_x_Resideo.svg?sanitize=true" width="350px"></a>

# Homebridge Resideo

<a href="https://www.npmjs.com/package/homebridge-resideo"><img title="npm version" src="https://badgen.net/npm/v/homebridge-resideo?icon=npm&label" ></a>
<a href="https://www.npmjs.com/package/homebridge-resideo"><img title="npm downloads" src="https://badgen.net/npm/dt/homebridge-resideo?label=downloads" ></a>
<a href="https://discord.gg/8fpZA4S"><img title="discord-resideo" src="https://badgen.net/discord/online-members/8fpZA4S?icon=discord&label=discord" ></a>
<a href="https://paypal.me/donavanbecker"><img title="donate" src="https://badgen.net/badge/donate/paypal/yellow" ></a>

<p>The Homebridge <a href="https://resideo.com">Resideo</a>
plugin allows you to access your Resideo Device(s) from HomeKit with
  <a href="https://homebridge.io">Homebridge</a>.
</p>

</span>

## Installation

1. Search for "Resideo" on the plugin screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).
2. Click **Install**.

## Configuration

1. Login / create an account at https://developer.honeywellhome.com/user
   - Your Resideo Developer Account, this account is different then your Resideo Account that you log into the Resideo App with
2. Click **Create New App**
3. Give your application a name
4. Copy the hostname found on #3 of the Intro Page into the Callback URL field

<p align="center">

<img src="https://user-images.githubusercontent.com/9875439/192078620-6998511c-1c11-4e06-b7e1-475b22ef5180.png" width="300px">

</p>

5. Enter the generated consumer key and secret into the plugin settings screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x)
6. Click **Link Account**

<p align="center">

<img src="https://user-images.githubusercontent.com/9875439/192078614-e568d121-e0e4-4123-bdda-4238e8a6e601.png" width="300px">

</p>

7. Login to your [https://www.resideo.com](https://account.honeywellhome.com).
8. Click Allow
9. Select Devices
   - I would recommend selecting all devices since you can restrict the devices you don't want in the Home app later, by DeviceID.
10. Click Connect
11. Click Save
    - If you plan on adding this plugin into a child bridge, I would configure that at this time before restarting Homebridge.
      - Reminder that you will have to add this child bridge into the home app to get Resideo accessories to show up.
12. Restart Homebridge

## Supported Resideo Devices

- [T10 Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/t10-pro-smart-thermostat-with-redlinkr-room-sensor-thx321wfs2001w-u/) - Already HomeKit Certified
- [T9 Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/t9-smart-thermostat-with-sensor-rcht9610wfsw2003-u/) - Already HomeKit Certified
  - [T9 Smart Roomsensors](https://www.resideo.com/us/en/products/air/thermostat-accessories/t9-smart-sensor-rchtsensor-1pk-u/)
- [T6 Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/t6-pro-smart-thermostat-multi-stage-3-heat-2-cool-th6320wf2003-u/) - Already HomeKit Certified
- [T5 Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/t5-smart-thermostat-with-c-wire-adapter-rcht8612wf2005-u/) - Already HomeKit Certified
- [Round Thermostat](https://www.resideo.com/us/en/products/air/thermostats/wifi-thermostats/the-round-smart-thermostat-rch9310wf5003-u/) - Already HomeKit Certified
- Some Total Comfort Control Thermostats
  - Pushing Commands may not be supported on some.
- [WiFi Water Leak & Freeze Detector](https://www.resideo.com/us/en/products/water/spot-leak-detection/wifi-water-leak-freeze-detector-rchw3610wf1001-u/)
