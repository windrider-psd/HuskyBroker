'use strict';

const Device = require('./models/Device')
const chalk = require('chalk');
const mosca = require('mosca');
const lodash = require('lodash');
const mongoose = require('mongoose');

/**
 * Callback for connection observers
 *
 * @callback connectionCallback
 * @param {Device.DeviceDocument} device - The device's document
 * @param {boolean} isConnected False if the device disconnected, true it connected
 */
/**
 * Callback for publish observers
 *
 * @callback publishCallback
 * @param {mosca.Packet} packet - the mqtt package
 * @param {Device.DeviceDocument} device - The device that published the message
 */
/**
 * Callback for subscription observers
 *
 * @callback subscritionCallback
 * @param {Device.DeviceDocument} device - The device's document
 * @param {String} topic The topic that the device is subscribed
 * @param {boolean} isSubscribed False if the device unsubscribed to the topic, true if subscribed 
 */

/**
* Callback for subscription observers
*
* @callback readyCallback
*/


class HuskyServer {

    constructor(mongoUrl, mqttPort, mqttUser, mqttPassword, adminUser, adminPassword) {
        this.mqttPort = mqttPort;
        this.mongoUrl = mongoUrl;
        this.mqttUser = mqttUser;
        this.mqttPassword = mqttPassword;
        this.adminUser = adminUser;
        this.adminPassword = adminPassword;
        this.isReady = false;
        this.deviceCount = 1;
        this.newDevicePrefix = "device ";

        /**
         * @type {Array.<Device.DeviceDocument>}
         */
        this.connectedDevices = new Array();

        /**
         * @type {Array.<connectionCallback>}
         */
        this.connectionCallbacks = new Array();

        /**
         * @type {Array.<publishCallback>}
         */
        this.publishCallbacks = new Array();
        /**
         * @type {Array.<subscritionCallback>}
         */
        this.subscritionCallbacks = new Array();

        /**
         * @type {Array.<readyCallback>}
         */
        this.readyCallbacks = new Array();

        mongoose.connect(mongoUrl).then(() => {
            Device.update({}, { deviceState: false });

            let moscaStorageOptions = {
                type: 'mongo',
                url: mongoUrl,
                pubsubCollection: 'ascoltatori',
                mong: {

                }
            }
            let moscaSettings = {
                port: mqttPort,
                backend: moscaStorageOptions
            }

            let authenticate = (client, user, password, callback) => {
                

                let isRegular = (user.toString() == this.mqttUser && password.toString() == this.mqttPassword);
                let isAdmin = (user.toString() == this.adminUser && password.toString() == this.adminPassword);
                let isValid = (isRegular || isAdmin);
                if (isValid) {
                    client.admin = isAdmin;
                }
                callback(null, autorizado);

            }

            let publishMiddleware = (client, topic, payload, callback) => {
                callback(null, client.admin == true || topic.split('/')[0] == client.id);
            }
            let subscriptionMiddleware = (client, topic, callback) => {
                callback(null, client.admin == true || topic.split('/')[0] == client.id);
            }




            this.server = new mosca.Server(moscaSettings);

            this.server.on('clientConnected', (client) => {

                let callConnectionCallbacks = (device) => {
                    this.connectionCallbacks.forEach(element => {
                        element(device, true);
                    });
                }
                Device.findOne({

                }, (err, device) => {
                    if (err) {
                        throw err;
                    }

                    let name = this.newDevicePrefix + this.deviceCount

                    if (!device) {
                        let debug = (client.id.indexOf("debug_") != -1) ? true : false;
                        device = new Device({
                            deviceId: client.id,
                            topics: new Array(),
                            name: name,
                            debug: debug
                        })

                        device.save();
                        this.AddConnectedDevice(device);

                        callConnectionCallbacks(device);
                    }
                    else {
                        this.AddConnectedDevice(device);
                        callConnectionCallbacks(device);
                    }
                })
            });

            this.server.on('published', (packet, client) => {

                let callPublishCallbacks = (device) => {
                    this.publishCallbacks.forEach(element => {
                        element(packet, device);
                    });
                }


                let payload = packet.payload.toString();
                let topic = packet.topic.toString();

                let parse = topic.split('/');
                try {
                    let device = this.FindDevice(parse[0])

                    if (parse[1] == 'status') {
                        if (device.status != payload) {

                            if (device.topics.length > 0) {
                                let message = "sub\n";
                                for (let i = 0; i < device.topics.length; i++) {
                                    device.topics.push(device.topics[i]);
                                    message += device.topics[i];
                                    if (typeof (device.topics[i + 1]) !== 'undefined') {
                                        message += '\r';
                                    }
                                }
                                PublishMessage(parse[0], message);
                            }


                            PublishMessage(parse[0], "sts\n1");

                            lodash.forEach(device.sensors, (sensor, index) => {
                                let message = `add_sensor\n${sensor.sensorType}\r${sensor.gpio}`
                                PublishMessage(parse[0], message);
                            })


                        }
                    }
                    else if (parse[1] == 'ligado') {
                        let newState = (payload == "1") ? true : false;
                        device.deviceState = newState;
                        device.save();
                    }
                    else if (parse[1] == "tipo") {
                        device.deviceType = Number(payload);
                        device.save();
                    }
                    callPublishCallbacks(device);

                }
                catch (err) { }
            });

            this.server.on('clientDisconnected', (client) => {

                let callConnectionCallbacks = (device) => {
                    this.connectionCallbacks.forEach(element => {
                        element(device, false);
                    });
                }

                let device = FindDevice(client.id);

                if (device) {
                    device.deviceState = false;
                    lodash.remove(this.connectedDevices, (d) => {
                        return d == device;
                    })
                    callConnectionCallbacks(device);
                }
            });

            this.server.on('ready', () => {
                this.authenticate = authenticate;
                this.authorizePublish = publishMiddleware;
                this.authorizeSubscribe = subscriptionMiddleware;
                this.isReady = true;

                lodash.forEach(this.readyCallbacks, callback => {
                    callback();
                })
            });
        });
    }

    /**
     * Sends a mqtt message with qos 1 and retain set to false
     * @param {string} topic 
     * @param {string} payload 
     */
    PublishMessage(topic, payload) {

        /**
         * @type {mosca.Message}
         */
        let message = {
            topic: topic,
            payload: payload,
            qos: 1,
            retain: false,
        };

        this.server.publish(message);
    }


    /**
     * Adds a device to the connected devices array
     * @param {Device.DeviceDocument} device 
     */
    AddConnectedDevice(device) {
        this.connectedDevices.push(device);
        this.deviceCount++;
    }

    /**
     * Removes a device from the connected devices array
     * @param {Device.DeviceDocument} device 
     */
    RemoveConnectedDevice(device) {
        lodash.remove(this.connectionCallbacks, (d) => {
            return device == d;
        })
    }

    /**
     * Adds a callback that will be executed once the server is ready
     * @param {readyCallback} callback 
     * @param {boolean} force If set to true. Callback will be executed even if the server was ready beforehand
     */
    OnReady(force, callback) {
        if (this.isReady && force) {
            callback();
        }
        else if (!this.isReady) {
            this.readyCallbacks.push(callback);
        }
    }

    /**
     * Adds a subscription observer
     * @param {connectionCallback} observer - A callback that will be executed everytime a device subscribes or unsubscribes to a topic
     */
    AddConnectionObserver(observer) {
        this.connectionCallbacks.push(observer);
    }

    RemoveConnectionObserver(observer) {
        lodash.remove(this.connectionCallbacks, (o) => {
            return observer == o;
        })
    }



    /**
     * Adds a subscription observer
     * @param {subscritionCallback} observer - A callback that will be executed everytime a device subscribes or unsubscribes to a topic
     */
    AddSubscritionObserver(observer) {
        this.subscritionCallbacks.push(observer);
    }

    /**
     * Removes a subscription observer
     * @param {subscritionCallback} observer 
     */
    RemoveSubscritionObserver(observer) {
        lodash.remove(this.subscritionCallbacks, (o) => {
            return observer == o;
        })
    }

    /**
     * Adds a publish observer
     * @param {publishCallback} observer - A callback that will be executed everytime a message is published
     */
    AddPublishObserver(observer) {
        this.publishCallbacks.push(observer);
    }


    /**
     * Removes a publish observer
     * @param {publishCallback} observer 
     */
    RemovePublishObserver(observer) {
        lodash.remove(this.publishCallbacks, (o) => {
            return observer == o;
        })
    }

    /**
     * Finds a device by it's Id
     * @param {String} deviceId 
     * @returns {Device.DeviceDocument|null} The device with the Id or null if there are no devices with this Id
     */
    FindDevice(deviceId) {
        return lodash.find(this.connectedDevices, (device, index) => {
            return deviceId == device.deviceId;
        }, 0)
    }

    /**
     * Subscribes a device to a topic.
     * @param {String} deviceId The device's Id
     * @param {String} topic The topic the device will subscribe
     * @returns {Promise<Device.DeviceDocument>} Returns a promise with the device's document. Will be rejected if the device is already subscribe to the topic or the device already is subscribed to 5 topics
     */
    SubscribeDeviceToTopic(deviceId, topic) {
        return new Promise((resolve, reject) => {
            Device.findOne(
                {
                    deviceId: deviceId
                }, (err, device) => {
                    if (err) {
                        reject(err);
                    }
                    else if (device != null) {

                        let callCallbacks = () => {
                            this.subscritionCallbacks.forEach(element => {
                                element(device, topic, true)
                            });
                        }

                        if (device.topics.length > 5) {
                            reject(new Error("The maximum amout of topics for a single device is 5."))
                            return;
                        }

                        for (let i = 0; i < device.topics.length; i++) {
                            if (device.topics[i] == topic) {
                                reject(new Error(`The device is already subscribed to ${topic}.`))
                                return;
                            }
                        }


                        this.PublishMessage(deviceId, `sub\n${topic}`);
                        device.topics.push(topic);

                        device.save()
                            .then(() => {
                                callCallbacks();
                                resolve();
                            })
                            .catch(err => {
                                reject(err);
                            });
                    }
                    else {
                        reject(new Error(`Device with ${deviceId} Id not found.`))
                    }
                });
        })
    }


    /**
     * Unsubscribes a device from a topic
     * @param {String} deviceId The device's Id
     * @param {String} topic The topic the device will unsubscribe
     * @returns {Promise<void>} Returns a promise with the device's document. Will be rejected if the device is not found.
     */
    UnsubscribeDeviceTopic(deviceId, topic) {

        return new Promise((resolve, reject) => {
            topic = topic.toLowerCase();
            Device.findOne(
                {
                    deviceId: deviceId
                }, (err, device) => {


                    if (err) {
                        reject(err);
                    }
                    else if (device) {

                        let callCallbacks = () => {
                            this.subscritionCallbacks.forEach(element => {
                                element(device, topic, false)
                            });
                        }

                        this.PublishMessage(deviceId, `unsub\n${topic}`);
                        lodash.remove(device.topics, (t) => {
                            return t == topic;
                        });

                        device.save()
                            .then(() => {
                                callCallbacks();
                                resolve();
                            })
                            .catch(err => {
                                reject(err);
                            });
                        
                    }
                    else {
                        reject(new Error("Device not found."));
                    }
                });
        })
    }

    /**
     * Retrieves all devices subscribed to a topic
     * @param {String} topic 
     * @returns {Promise<Array<Device.DeviceDocument>}
     */

    GetDevicesSubToTopic(topic) {
        return new Promise((resolve, reject) => {
            topic = topic.toLowerCase();
            let returnedDevices = new Array();

            Device.find((err, allDevices) => {
                if (err) {
                    reject(err);
                }
                else {
                    lodash.forEach(allDevices, (device) => {
                        lodash.forEach(device.topics, (deviceTopic) => {
                            if (topic.toLowerCase() == deviceTopic) {
                                returnedDevices.push(device);
                                return false;
                            }
                        })
                    })
                }
            })

            resolve(returnedDevices);
        });
    }

    /**
     * Sets the relay state of all devices subscribed to a topic. It doesn't affect not connected devices
     * @param {string} topic 
     * @param {boolean} state True if the relay should be opened, false if it should be closed.
     * @returns {Promise<Array<Device.DeviceDocument>>} Returns a promise with all the devices affected 
     */
    SetDeviceStateByTopic(topic, state) {
        return new Promise((resolve, reject) => {
            Device.find((devices) => {
                if (err) {
                    reject(err);
                }
                else {
                    /**
                     * @type {Array.<Device.DeviceDocument>}
                     */
                    let returnedDevices;
                    lodash.forEach(devices, (device) => {
                        lodash.forEach(device.topics, (deviceTopic) => {
                            if (topic.toLowerCase() == deviceTopic) {
                                device.deviceState = state;
                                this.SetDeviceStateById(device.deviceId, state);
                                returnedDevices.push(device);
                                return false;
                            }
                        })
                    })
                    resolve(returnedDevices);
                }
            })
        })
    }

    /**
     * Sets the relay state by a device's Id.
     * @param {string} deviceId 
     * @param {boolean} state True if the relay should be opened, false if it should be closed.
     * @returns {Promise<Array<Device.DeviceDocument>>} Returns a promise with the affected device. It's rejected if the device does not exists or is not connected;
     */
    SetDeviceStateById(deviceId, state) {
        return new Promise((resolve, reject) => {

            let device = lodash.find(this.connectedDevices, (d) => {
                return d.deviceId == deviceId;
            })

            if (device) {
                device.deviceState = state;

                device.save((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        this.PublishMessage(deviceId, `tp\n${(state) ? '1' : '0'}`);
                        resolve(device);
                    }
                })

            }
            else {
                reject(new Error("Device not found or not connected"));
            }

        })
    }

    /**
     * Sets the relay state by a device's name
     * @param {string} deviceName 
     * @param {boolean} state True if the relay should be opened, false if it should be closed.
     * @returns {Promise<Array<Device.DeviceDocument>>} Returns a promise with the affected device. It's rejected if the device does not exists or is not connected;
     */
    SetDeviceStateByName(deviceName, state) {
        return new Promise((resolve, reject) => {

            let device = lodash.find(this.connectedDevices, (d) => {
                return d.name == deviceName;
            })

            if (device) {
                device.deviceState = state;

                device.save((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        this.PublishMessage(device.deviceId, `tp\n${(state) ? '1' : '0'}`);
                        resolve(device);
                    }
                })

            }
            else {
                reject(new Error("Device not found or not connected"));
            }
        })
    }

    /**
	 * Attach a sensor to a device by it's Id
	 * @param {number} deviceId 
	 * @param {string} sensor 
	 * @param {string} gpio The GPIO that the sensor operates
	 * @returns {Promise.<Device.DeviceDocument>} Returns a promise with the affected device. It's rejected if the device is not found, or if there is already another sensor using the same gpio
	 */
    AddSensor(deviceId, sensor, gpio) {
        return new Promise((resolve, reject) => {
            Device.findOne({ deviceId: deviceId },
                (err, device) => {
                    if (err) {
                        reject(err)
                    }
                    else if (!device) {
                        reject(new Error("Device not found"))
                    }
                    else {
                        let validGPIO = true

                        lodash.forEach(device.sensors, (sensor) => {
                            if (sensor.gpio == gpio) {
                                validGPIO = false;
                                return false;
                            }
                        })

                        if (validGPIO) {
                            device.sensors.push({ sensorType: sensor, gpio: gpio })
                            device.save((err) => {
                                if (err) {
                                    reject(err)
                                }
                                else {
                                    let topicString = `${deviceId}`
                                    let messageString = `add_sensor\n${sensor}\r${gpio}`
                                    this.PublishMessage(topicString, messageString);
                                    resolve()
                                }
                            })
                        }
                        else {
                            reject(new Error("Only one sensor can use the same gpio"))
                        }

                    }
                }
            )
        })

    }

	/**
	 * Detach a sensor of a device by it's Id
	 * @param {number} deviceId 
	 * @param {string} gpio The GPIO that the sensor is operating
	 * @returns {Promise.<{device: Device.DeviceDocument, sensor: String}>} Returns a promise with the device's document and the removed sensor type. It's rejected if the device does not exists
	 */
    RemoveSensor(deviceId, gpio) {

        return new Promise((resolve, reject) => {
            Device.findOne({ deviceId: deviceId },
                (err, device) => {
                    if (err) {
                        reject(err)
                    }
                    else if (!device) {
                        reject(new Error("Device not found"))
                    }
                    else {
                        let removedSensor = null;
                        lodash.remove(device.sensors, (sensor) => {
                            if (sensor.gpio == gpio) {
                                removedSensor = sensor.sensorType;
                                return true;
                            }
                        })

                        device.save((err) => {
                            if (err) {
                                reject(err)
                            }
                            else {
                                let topicString = `${deviceId}`
                                let messageString = `rem_sensor\n${gpio}`
                                this.PublishMessage(topicString, messageString);
                                resolve({ device: device, sensor: removedSensor })
                            }
                        })


                    }
                }
            )
        })
    }

	/**
	 * Updates a device's sensor's GPIO
	 * @param {number} deviceId 
	 * @param {string} sensor 
	 * @param {string} gpio The new GPIO
	 * @returns {Promise.<Device.DeviceDocument>} Returns a promise with the device's document. It's rejected if there is already another sensor operation on the new GPIO or the sensor is not found on the device.
	 */
    UpdateSensorGPIO(deviceId, sensor, gpio) {
        return new Promise((resolve, reject) => {
            Device.findOne({ deviceId: deviceId },
                (err, device) => {
                    if (err) {
                        reject(err)
                    }
                    else if (!device) {
                        reject(new Error("Device not found"))
                    }
                    else {
                        let sensorIndex = null;

                        lodash.forEach(device.sensors, (s, index) => {
                            if (s.sensorType != sensor && s.gpio == gpio) {
                                reject(new Error(`Another sensor has the ${gpio} gpio`))
                                return false;
                            }
                            else if (s.sensorType == s) {
                                sensorIndex = index;
                                return false;
                            }
                        })

                        if (sensorIndex) {
                            let oldGPIO = device.sensors[sensorIndex].gpio;

                            let topicString = `${deviceId}/edit_sensor`
                            let messageString = `${oldGPIO}\r${gpio}`

                            device.sensors[sensorIndex].gpio = gpio;

                            device.save((err) => {
                                if (err) {
                                    reject(err)
                                }
                                else {
                                    this.PublishMessage(topicString, messageString);
                                    resolve(device)
                                }
                            })
                        }
                        else {
                            reject(new Error("Sensor not found"));
                        }

                    }
                }
            )
        })
    }

}

module.exports = {HuskyServer : HuskyServer, Device : Device}