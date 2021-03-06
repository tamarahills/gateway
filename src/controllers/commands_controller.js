/**
 * Commands Controller.
 *
 * Manages HTTP requests to /commands.
 *
 * Grammar that the parser understands:
 *  Turn the <tag> light <on|off>
 *  Turn <tag> <on|off>
 *  Shut <tag> <on|off>
 *  Shut the <tag> light <on|off>
 *
 * <tag> must match the .name property of one of the /things objects
 *  in order for the command to be executed.
 *
 * Sample curl command to test from the command line:
 * curl -H 'Authorization:Bearer '<JSONWebToken>'
 *        -H "Content-Type: application/json"
 *        -H "Accept: application/json"
 *        -d '{"text":"turn the kitchen light on"}'
 *        https://localhost:4443/commands
 *        -k
 *
 * HTTP Response Codes        Status message
 *              201           Command Created
 *              400           Text element not defined
 *              404           Thing Not Found
 *              406           Unable to understand command
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const express = require('express');
const Constants = require('../constants.js');
const rp = require('request-promise');

const CommandsController = express.Router();


const aiOptions = {
  uri: 'https://api.api.ai/api/query',
  method: 'POST',
  body: '',
  headers: {
    'Authorization': 'Bearer af2bccd942c24fd68622efc6b4c8526c',
    'Content-Type': 'application/json'
  }
};

const thingsOptions = {
  uri: '',
  rejectUnauthorized: false,
  body: '',
  method: 'GET',
  headers: {
    'Authorization': '',
    'Accept': 'application/json'
  }
};

const iotOptions = {
  uri: '',
  method: 'PUT',
  rejectUnauthorized: false,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
  body: ''
};

/**
 * Local Variables for the Gateway Href and the Web Token since the
 * CommandsController will be posting to itself.
 */
CommandsController.gatewayRef = '';
CommandsController.jwt = '';

/**
 * Called by the app.js to configure the auth header and the address of the GW
 *  since the CommandsController will be posting to itself.
 */
CommandsController.configure =  function(gatewayHref, jwt) {
  CommandsController.gatewayHref = gatewayHref;
  CommandsController.jwt = jwt;
};

/**
 * Parses the intent for a text sentence and sends to the API.ai intent
 * parser to determine intent.  Then executes the intent as an action on the
 * thing API.
 */
CommandsController.post('/', function (request, response) {

  if(!request.body || request.body.text === undefined) {
    response.status(400).send(JSON.stringify(
      {'message': 'Text element not defined'}));
    return;
  }

  aiOptions.body = JSON.stringify(getAiBody(request.body.text));
  rp(aiOptions)
    .then(function(aiBody) {
      var payload = parseAIBody(aiBody);
      if (payload.cmd == 'IOT') {
        thingsOptions.uri = CommandsController.gatewayHref +
          Constants.THINGS_PATH;
        thingsOptions.headers.Authorization = 'Bearer ' +
          CommandsController.jwt;

        rp(thingsOptions)
          .then(function(thingBody) {
            let jsonBody = JSON.parse(thingBody);
            let match = payload.param.toUpperCase();
            for (var i = 0; i < jsonBody.length; i++) {
              var obj = jsonBody[i];
              let name = obj.name.toUpperCase();
              if (name == match) {
                payload.href = obj.properties.on.href;
                break;
              }
            }
            if (payload.href != '') {
              // Returning 201 to signify that the command was mapped to an
              // intent and matched a 'thing' in our list.  Return a response to
              // caller with this status before the command finishes execution
              // as the execution can take some time (e.g. blinds)
              response.status(201).send(JSON.stringify(
                {'message': 'Command Created'}));
              iotOptions.uri = CommandsController.gatewayHref + payload.href;
              iotOptions.headers.Authorization = 'Bearer ' +
                CommandsController.jwt;

              (payload.param2 == 'on')?
                iotOptions.body = JSON.stringify({'on': true}):
                iotOptions.body = JSON.stringify({'on': false});
              rp(iotOptions)
                .then(function() {
                  // In the future we may want to use WS to give a status of
                  // the disposition of the command execution..
                })
                .catch(function(err) {
                  // Future, give status via WS.
                  console.log('catch inside PUT:' + err);
                });
            } else {
              response.status(404).send(JSON.stringify(
                {'message': 'Thing not found'}));
            }
          })
          .catch(function(err) {
            console.log('error catch:' + err);
          });
      } else {
        response.status(406).send(JSON.stringify(
          {'message': 'Unable to understand command'}));
      }
    })
    .catch(function(err) {
      response.json('error: ' + err);
    });
});

/**
 * Formats the body for the request to API.ai and returns the String
 */
function getAiBody(text) {
  let body = {
    'v':'20150910',
    'query': '',
    'lang':'en',
    'sessionId':'b083ae95-e39a-4954-a05b-84687f50f790'
  };
  body.query = text;
  return body;
}

/**
 * Parses the Response returned by the API.ai and returns a JSON object that
 * describes the command (in this case iot), the param (room), and the param2
 * (on/off).
 */
function parseAIBody(aiBody) {
  let jsonBody = JSON.parse(aiBody);
  var payload = {
    cmd: 'none',
    param: 'none',
    param2: 'none',
    href: ''
  };
  //Determine the action from the API.AI intent parser
  switch (jsonBody.result.action) {
    case 'iot':
      payload.cmd = 'IOT';
      payload.param = jsonBody.result.parameters.rooms;
      payload.param2 = jsonBody.result.parameters.onoff;
      break;
    case 'input.unknown':
      console.log('unable to parse the intent');
      break;
    default:
      console.log('No match');
      break;
  }
  return payload;
}

module.exports = CommandsController;
