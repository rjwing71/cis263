// Copyright (c) 2017 Electric Imp
// This file is licensed under the MIT License
// http://opensource.org/licenses/MIT

'use strict';

const http = require('http');
const url = require('url');
const pg = require('pg');

const PORT = process.env.PORT;
const DATABASE_URL = process.env.DATABASE_URL;
const TABLE_NAMES = {
    "fridge": "salesforce.SmartFridge__c",
    "case": "salesforce.Case"
};

(() => {
    pg.defaults.ssl = true;
    let server = http.createServer((req, res) => {
        let received = "";
        req.on('data', (chunk) => {
            received += chunk;
        });
        req.on('end', () => {
            let response = function(code, data) {
                res.writeHead(code, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                });
                res.write(JSON.stringify(data));
                res.end();
            };
            let parsedUrl = url.parse(req.url, true);
            console.log(req.method, parsedUrl['path'], received);
            switch(parsedUrl['pathname']){
                case "/sobjects/Update":
                    sUpdate(parsedUrl['query'], received)
                        .then((result) => response(200, result))
                        .catch((error) => response(error.code, error.obj));
                    break;
                case "/sobjects/Case":
                    sCase(parsedUrl['query'], received)
                        .then((result) => response(200, result))
                        .catch((error) => response(error.code, error.obj));
                    break;
                default:
                    response(400, {
                        'state': 'error',
                        'message': 'Unsupported request'
                    });
                    break;
            }
        });
        req.on('aborted', () => {
            res.end();
        });
    });
    server.listen(PORT, () => {
        console.log("Server running on port", PORT);
    });
})();

/**
 * sUpdate - update fridge table at postgres
 * Returns: Promise
 * Parameters:
 *     query : object - parsed query of the request
 *     received : string - body's text of the request
 */
function sUpdate(query, received){
    return promise(query, received, function(query, resolve, reject){
        if (query['deviceId__c'] === undefined) {
            reject({
                'code': 400, 
                'obj': {
                    'state': "error",
                    'message': "'deviceId__c' field required"
                }
            });
            return;
        }
        pg.connect(DATABASE_URL, function(err, client, done) {
            if (err) {
                reject({
                    'code': 500, 
                    'obj': {
                        'state': "error",
                        'message': err.message
                    }
                });
                done();
                return;
            }
            let changes = [];
            for (let key in query) {
                if (!['door__c', 'temperature__c', 'humidity__c', 'ts__c'].includes(key)) continue;
                let value = query[key];
                switch (typeof(value)) {
                    case "number": changes.push(`${key}=${value}`); break;
                    case "string": changes.push(`${key}='${value}'`); break;
                }
            }
            if (changes.length > 0) {
                client.query(`SELECT deviceId__c FROM ${TABLE_NAMES['fridge']} WHERE deviceId__c='${query['deviceId__c']}'`, function(err, result) {
                    if (err) {
                        reject({
                            'code': 500, 
                            'obj': {
                                'state': "error",
                                'message': err.message
                            }
                        });
                        done();
                        return;
                    }
                    let sql;
                    if (result.rows.length > 0) {
                        sql = `UPDATE ${TABLE_NAMES['fridge']} SET ${changes.join(',')} WHERE deviceId__c='${query['deviceId__c']}'`;
                    } else {
                        let door__c = query['door__c'] === undefined ? 'closed' : query['door__c'];
                        let temperature__c = query['temperature__c'] === undefined ? 0 : query['temperature__c'];
                        let humidity__c = query['humidity__c'] === undefined ? 0 : query['humidity__c'];
                        let ts__c = query['ts__c'] === undefined ? '2000-01-01T00:00:00Z' : query['ts__c'];
                        sql = `INSERT INTO ${TABLE_NAMES['fridge']} (deviceId__c, door__c, temperature__c, humidity__c, ts__c) VALUES ('${query['deviceId__c']}', '${door__c}', ${temperature__c}, ${humidity__c}, '${ts__c}')`;
                    }
                    client.query(sql, function(err, result) {
                        if (err) {
                            reject({
                                'code': 500, 
                                'obj': {
                                    'state': "error",
                                    'message': err.message
                                }
                            });
                            done();
                            return;
                        }
                        console.log("DONE REQUEST: " + sql);
                        done();
                        resolve({
                            'state': "done",
                            'message': ""
                        });
                    });
                });
            } else {
                reject({
                    'code': 400, 
                    'obj': {
                        'state': "error",
                        'message': "At least one field required"
                    }
                });
            }
        });
    });
}

/**
 * sCase - update case table at postgres
 * Returns: Promise
 * Parameters:
 *     query : object - parsed query of the request
 *     received : string - body's text of the request
 */
function sCase(query, received){
    return promise(query, received, function(query, resolve, reject){
        if (query['Subject'] === undefined || query['Description'] === undefined || query['Related_Fridge__r'] === undefined) {
            reject({
                'code': 400, 
                'obj': {
                    'state': "error",
                    'message': "Missed some fields"
                }
            });
            return;
        }
        if (query['Related_Fridge__r']['DeviceId__c'] === undefined) {
            reject({
                'code': 400, 
                'obj': {
                    'state': "error",
                    'message': "Related_Fridge__r.DeviceId__c field required"
                }
            });
            return;
        }
        pg.connect(DATABASE_URL, function(err, client, done) {
            if (err) {
                reject({
                    'code': 500, 
                    'obj': {
                        'state': "error",
                        'message': err.message
                    }
                });
                done();
                return;
            }
            client.query(`SELECT deviceId__c FROM ${TABLE_NAMES['fridge']} WHERE deviceId__c='${query['Related_Fridge__r']['DeviceId__c']}'`, function(err, result) {
                if (err) {
                    reject({
                        'code': 500, 
                        'obj': {
                            'state': "error",
                            'message': err.message
                        }
                    });
                    done();
                    return;
                }
                if (result.rows.length > 0) {
                    sInsertCase(query, resolve, reject, client, done);
                } else {
                    let sql = `INSERT INTO ${TABLE_NAMES['fridge']} (deviceId__c, door__c, temperature__c, humidity__c, ts__c) VALUES ('${query['Related_Fridge__r']['DeviceId__c']}', 'closed', 0, 0, '2000-01-01T00:00:00Z')`;
                    client.query(sql, function(err, result) {
                        if (err) {
                            reject({
                                'code': 500, 
                                'obj': {
                                    'state': "error",
                                    'message': err.message
                                }
                            });
                            done();
                            return;
                        }
                        console.log("DONE REQUEST: " + sql);
                        sInsertCase(query, resolve, reject, client, done);
                    });
                }
            });
        });
    });
}

/**
 * sInsertCase - second part of the sCase function
 * Returns: undefined
 * Parameters:
 *     query : object - parsed query of the request
 *     resolve : function - Promise resolve function
 *     reject : function - Promise reject function
 *     client : object - postgres client
 *     done : function - postgres on done fuction
 */
function sInsertCase(query, resolve, reject, client, done){
    let sql = `INSERT INTO ${TABLE_NAMES['case']} (Subject, Description, Related_Fridge__r__deviceId__c) VALUES ('${query['Subject']}', '${query['Description']}', '${query['Related_Fridge__r']['DeviceId__c']}') RETURNING Id`;
    client.query(sql, function(err, result) {
        if (err) {
            reject({
                'code': 500, 
                'obj': {
                    'state': "error",
                    'message': err.message
                }
            });
            done();
            return;
        }
        console.log("DONE REQUEST: " + sql);
        done();
        resolve({
            'state': "done",
            'message': "",
            'id': result.rows.length > 0 ? result.rows[0]['id'] : ''
        });
    });
}

/**
 * promise - parse query and body of the request and continue with proceed function
 * Returns: Promise
 * Parameters:
 *     query : object - parsed query of the request
 *     received : string - body's text of the request
 *     proceed : function - function for processing
 */
function promise(query, received, proceed){
    return new Promise((resolve, reject) => {
        let jsonReceived = null;
        try {
            jsonReceived = JSON.parse(received);
        } catch (e) {}
        if (jsonReceived !== null){
            proceed(jsonReceived, resolve, reject);
        } else if (query !== null) {
            proceed(query, resolve, reject);
        } else {
            reject({
                'code': 400, 
                'obj': {
                    'state': "error",
                    'message': "JSON or query required"
                }
            });
        }
    });
}
