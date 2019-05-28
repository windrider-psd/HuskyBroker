const mongoose = require('mongoose');
const Schema = mongoose.Schema;

let deviceSchema = new Schema(
{
        deviceId:
        {
            type: String,
            required: true
        },
        name:
        {
            type: String,
            required: true
        },
        topics: [
        {
            type: String
        }],
        sensors:
        [
            {
                sensorType: String,
                gpio: { type: String }
            }
        ],
        isDebug:
        {
            type: Boolean,
            default: false
        },
        deviceState : 
        {
            type: Boolean,
            default: false
        },
        deviceType: Number
});


/**
 * @typedef DeviceDocument
 * @property {string} deviceId The device's Id. Usually it should be the MAC address. 
 * @property {string} name The device's display name
 * @property {Array<String>} topics All the topics the device is subscribed
 * @property {Array.<{sensorType: String, gpio: String}>} sensors All the sensors attached to the device
 * @property {Boolean} isDebug Is the device a debug deviec?
 * @property {Boolean} deviceState The device's relay state. False if closed or nonexistent, true if opened.
 * @property {Number} deviceType The type of the device.
 * @property {Function} save Saves the document on the database. Retunrs a promise.
 */


const Model = mongoose.model('devices', deviceSchema);


module.exports = Model;