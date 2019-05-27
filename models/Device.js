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

module.exports = mongoose.model('devices', deviceSchema);