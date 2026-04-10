/**
 * Copyright (c) 2026 Catalyst Tech Corp
 * All Rights Reserved.
 *
 * This software is the confidential and proprietary information of
 * Catalyst Tech Corp. ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in
 * accordance with the terms of the license agreement you entered into
 * with Catalyst Tech.
 *
 * Script Name: CTC VC2 | Utility Library
 *
 * @author brianf@nscatalyst.com
 * @description General utility library for VAR Connect 2.x (core helpers, logging, cache, etc.)
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-28   brianf        Replaced cache key truncation with MD5 hashing via N/crypto; added 500KB value guard to setNSCache
 * 2026-03-27   brianf        Added logTitle in tryThese; fixed sendRequestRestlet retry call; fixed SERVICES_RL script/deploy path; fixed LogPrefix ref in vcLog
 * 2026-01-29   brianf        Migrated missing utility functions from CTC_VC2_Lib_Utils.js; refactored to CTC_UTIL object, standards-compliant formatting/naming
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var LogTitle = 'CTC_UTIL';

    var ns_runtime = require('N/runtime'),
        ns_format = require('N/format'),
        ns_record = require('N/record'),
        ns_search = require('N/search'),
        ns_cache = require('N/cache'),
        ns_config = require('N/config'),
        momentLib = require('./moment'),
        ns_xml = null,
        ns_url = null;

    var CTC_GLOBAL = require('./ctc_lib_constants');
    var CTC_UTIL = {};

    // CHECKERS
    util.extend(CTC_UTIL, {
        /**
         * Checks if a value is empty (null, undefined, empty string, empty array/object).
         * @param {*} stValue - Value to check
         * @returns {boolean}
         */
        isEmpty: function (stValue) {
            return (
                stValue === '' ||
                stValue == null ||
                stValue == undefined ||
                stValue == 'undefined' ||
                stValue == 'null' ||
                (util.isArray(stValue) && stValue.length == 0) ||
                (util.isObject(stValue) &&
                    (function (v) {
                        for (var k in v) return false;
                        return true;
                    })(stValue))
            );
        },

        /**
         * Checks if a value exists in an array.
         * @param {*} stValue - Value to search for
         * @param {Array} arrValue - Array to search
         * @returns {boolean}
         */
        inArray: function (stValue, arrValue) {
            if (!stValue || !arrValue) return false;
            for (var i = arrValue.length - 1; i >= 0; i--) if (stValue == arrValue[i]) break;
            return i > -1;
        },

        /**
         * Checks if a value is undefined.
         * @param {*} value - Value to check
         * @returns {boolean}
         */
        isUndefined: function (value) {
            // Obtain `undefined` value that's guaranteed to not have been re-assigned
            var undefined = void 0;
            return value === undefined;
        },

        /**
         * Validates required parameters in an option object.
         * @param {Object} option - Option object with params and reqd fields
         * @returns {boolean}
         */
        paramCheck: function (option) {
            // Validate shape
            if (!option || !option.params || !util.isObject(option.params)) return false;
            if (!option.reqd) return true; // no required fields

            // Normalize required list
            if (!util.isArray(option.reqd)) option.reqd = [option.reqd];
            var hasMissing = false;

            option.reqd.forEach(function (field) {
                if (util.isArray(field)) {
                    return; // no-op
                } else {
                    if (
                        !option.params.hasOwnProperty(field) ||
                        CTC_UTIL.isEmpty(option.params[field])
                    ) {
                        hasMissing = true;
                    }
                }
            });

            return !hasMissing;
        },

        /**
         * Checks if a value is considered true (true, 'T', 't').
         * @param {*} value - Value to check
         * @returns {boolean}
         */
        isTrue: function (value) {
            return this.inArray(value, [true, 'T', 't']);
        }
    });

    // CACHING
    util.extend(CTC_UTIL, {
        CACHE: {},

        /**
         * Retrieves a value from in-memory cache.
         * @param {string} cacheKey - Cache key
         * @returns {*}
         */
        getCache: function (cacheKey) {
            return CTC_UTIL.CACHE.hasOwnProperty(cacheKey) ? CTC_UTIL.CACHE[cacheKey] : null;
        },

        /**
         * Sets a value in in-memory cache.
         * @param {string} cacheKey - Cache key
         * @param {*} objVar - Value to cache
         */
        setCache: function (cacheKey, objVar) {
            CTC_UTIL.CACHE[cacheKey] = objVar;
        },
        hashCacheKey: function (cacheKey) {
            if (!cacheKey || cacheKey.length <= 60) return cacheKey;
            return cacheKey.substring(0, 25) + '..' + cacheKey.substring(cacheKey.length - 33);
        },
        NSCACHE_NAME: CTC_GLOBAL.CACHE_NAME,
        NSCACHE_KEY: 'VC_20240101',
        NSCACHE_TTL: CTC_GLOBAL.CACHE_TTL,

        /**
         * Retrieves a value from NetSuite cache.
         * @param {Object} option - Cache options
         * @returns {*}
         */
        getNSCache: function (option) {
            var returnValue;
            try {
                var cacheName = CTC_GLOBAL.CACHE_NAME,
                    cacheTTL = option.cacheTTL || CTC_UTIL.NSCACHE_TTL;

                var cacheKey = option.cacheKey || option.key || option.name || CTC_UTIL.NSCACHE_KEY;
                if (!cacheKey) throw 'Missing cacheKey!';
                cacheKey = CTC_UTIL.hashCacheKey(cacheKey);

                var cacheObj = ns_cache.getCache({
                    name: cacheName,
                    scope: ns_cache.Scope.PUBLIC
                });

                returnValue = cacheObj.get({ key: cacheKey, ttl: cacheTTL });
                if (option.isJSON && returnValue) returnValue = CTC_UTIL.safeParse(returnValue);

                // vc2_util.log('## NS CACHE (FETCH) ##', '//', [cacheKey]);
            } catch (error) {
                CTC_UTIL.logWarn('getNSCache', error);
                returnValue = null;
            }

            return returnValue;
        },

        /**
         * Sets a value in NetSuite cache.
         * @param {Object} option - Cache options
         */
        setNSCache: function (option) {
            try {
                var cacheName = CTC_GLOBAL.CACHE_NAME,
                    cacheTTL = option.cacheTTL || CTC_UTIL.NSCACHE_TTL;

                var cacheKey = option.cacheKey || option.key || option.name || CTC_UTIL.NSCACHE_KEY;
                if (!cacheKey) throw 'Missing cacheKey!';
                cacheKey = CTC_UTIL.hashCacheKey(cacheKey);

                var cacheValue = option.value || option.cacheValue;
                if (CTC_UTIL.isEmpty(cacheValue)) throw 'Missing cache value!';
                if (!util.isString(cacheValue)) cacheValue = JSON.stringify(cacheValue);
                if (cacheValue.length > 500000) throw 'Cache value exceeds 500KB limit (size: ' + cacheValue.length + ')';

                var cacheObj = ns_cache.getCache({
                    name: cacheName,
                    scope: ns_cache.Scope.PUBLIC
                });
                cacheObj.put({ key: cacheKey, value: cacheValue, ttl: cacheTTL });
                // vc2_util.log('## NS CACHE (STORED) ##', '// ', [cacheKey, cacheTTL]);
            } catch (error) {
                CTC_UTIL.logWarn('setNSCache', error);
            }
        },

        /**
         * Removes a value from NetSuite cache.
         * @param {Object} option - Cache options
         */
        removeCache: function (option) {
            try {
                var cacheName = CTC_GLOBAL.CACHE_NAME,
                    cacheTTL = option.cacheTTL || CTC_UTIL.NSCACHE_TTL;

                var cacheKey = option.cacheKey || option.key || option.name || CTC_UTIL.NSCACHE_KEY;
                if (!cacheKey) throw 'Missing cacheKey!';
                cacheKey = CTC_UTIL.hashCacheKey(cacheKey);

                var cacheObj = ns_cache.getCache({
                    name: cacheName,
                    scope: ns_cache.Scope.PUBLIC
                });
                cacheObj.remove({ key: cacheKey });

                CTC_UTIL.log('## NS CACHE (REM) ##', '// ', [cacheName, cacheKey, cacheTTL]);
            } catch (error) {
                CTC_UTIL.logWarn('removeNSCache', error);
            }
        },

        /**
         * Saves a cache key to a named cache list.
         * @param {Object} option - Options with listName and cacheKey
         * @returns {Object}
         */
        saveCacheList: function (option) {
            var listName = option.listName,
                cacheKey = option.cacheKey;

            var cacheListName = [listName, 'LIST'].join('___');
            var cacheListValue = CTC_UTIL.getNSCache({ name: cacheListName, isJSON: true });

            if (CTC_UTIL.isEmpty(cacheListValue)) cacheListValue = { LIST: [cacheListName] };

            if (!CTC_UTIL.inArray(cacheKey, cacheListValue.LIST))
                cacheListValue.LIST.push(cacheKey);

            CTC_UTIL.log('## NS CACHE (list)', ' // CACHE List: ', [
                listName,
                cacheKey,
                cacheListValue
            ]);

            CTC_UTIL.setNSCache({
                cacheKey: cacheListName,
                value: cacheListValue
            });

            return cacheListValue;
        },

        /**
         * Deletes all cache keys in a named cache list.
         * @param {Object} option - Options with listName
         */
        deleteCacheList: function (option) {
            var listName = option.listName;

            var cacheListName = [listName, 'LIST'].join('___');
            var cacheListValue = CTC_UTIL.getNSCache({ name: cacheListName, isJSON: true });

            CTC_UTIL.log('## NS CACHE (reset list)', ' // CACHE List: ', [listName]);

            if (CTC_UTIL.isEmpty(cacheListValue) || CTC_UTIL.isEmpty(cacheListValue.LIST)) return;

            cacheListValue.LIST.forEach(function (cacheKey) {
                CTC_UTIL.removeCache({ name: cacheKey });
                return true;
            });
        }
    });

    // UTILITIES
    util.extend(CTC_UTIL, {
        /**
         * Busy-wait for a specified number of milliseconds.
         * @param {number} waitms - Milliseconds to wait
         * @returns {boolean}
         */
        waitMs: function (waitms) {
            var logTitle = [LogTitle, 'waitMs'].join('::');
            waitms = waitms || 5000;

            log.audit(logTitle, 'waiting for ' + waitms);

            var nowDate = new Date(),
                isDone = false;
            while (!isDone) {
                var deltaMs = new Date() - nowDate;
                isDone = deltaMs >= waitms;
                if (deltaMs % 1000 == 0) {
                    log.audit(logTitle, '...' + deltaMs);
                }
            }

            return true;
        },

        /**
         * Parses a string to float, removing non-numeric characters.
         * @param {*} stValue - Value to parse
         * @returns {number}
         */
        parseFloat: function (stValue) {
            var returnValue = 0;
            try {
                returnValue = stValue
                    ? parseFloat(stValue.toString().replace(/[^0-9.-]+/g, '') || '0')
                    : 0;
            } catch (e) {}

            return returnValue;
        },

        /**
         * Forces a value to integer, returns 0 if invalid.
         * @param {*} stValue - Value to convert
         * @returns {number}
         */
        forceInt: function (stValue) {
            var intValue = parseInt(stValue, 10);

            if (isNaN(intValue) || stValue == Infinity) {
                return 0;
            }

            return intValue;
        },

        /**
         * Forces a value to float, returns 0.0 if invalid.
         * @param {*} stValue - Value to convert
         * @returns {number}
         */
        forceFloat: function (stValue) {
            var flValue = this.parseFloat(stValue);

            if (isNaN(flValue) || stValue == Infinity) {
                return 0.0;
            }

            return flValue;
        },

        /**
         * Loads a module using require.
         * @param {string} mod - Module name
         * @returns {*}
         */
        loadModule: function (mod) {
            var returnValue = require(mod);
            return returnValue;
        },

        /**
         * Loads a NetSuite module asynchronously.
         * @param {string} mod - Module name
         * @returns {*}
         */
        loadModuleNS: function (mod) {
            var returnValue;
            require([mod], function (nsMod) {
                returnValue = nsMod;
            });
            return returnValue;
        },

        /**
         * Busy-wait for a random number of milliseconds up to max.
         * @param {number} max - Maximum milliseconds
         * @returns {boolean}
         */
        waitRandom: function (max) {
            var logTitle = [LogTitle, 'waitRandom'].join('::');

            var waitTimeMS = Math.floor(Math.random() * Math.floor(max));
            max = max || 5000;

            log.audit(logTitle, 'waiting for ' + waitTimeMS);
            var nowDate = new Date(),
                isDone = false;

            while (!isDone) {
                var deltaMs = new Date() - nowDate;
                isDone = deltaMs >= waitTimeMS;
                if (deltaMs % 1000 == 0) {
                    log.audit(logTitle, '...' + deltaMs);
                }
            }
            log.audit(logTitle, '>> Total Wait: ' + (new Date() - nowDate));
            return true;
        },

        /**
         * Generates a random string based on current timestamp.
         * @param {number} len - Length of string
         * @returns {string}
         */
        randomStr: function (len) {
            len = len || 5;
            var str = new Date().getTime().toString();
            return str.substring(str.length - len, str.length);
        },

        randomUniq: function (len) {
            var logTitle = [LogTitle, 'randomUniq'].join('::');
            var returnValue = '';

            len = CTC_UTIL.forceInt(len) || 8;
            if (len < 1) return returnValue;

            try {
                while (returnValue.length < len) {
                    returnValue += new Date().getTime().toString(36);
                    returnValue += Math.floor(Math.random() * 1000000000000).toString(36);
                }
            } catch (error) {
                CTC_UTIL.logWarn(logTitle, error);
                returnValue = '';

                while (returnValue.length < len) {
                    returnValue += CTC_UTIL.randomStr(len);
                }
            }

            return returnValue.substring(0, len);
        },

        /**
         * Rounds a number to specified decimal places.
         * @param {*} value - Value to round
         * @param {number} [places=2] - Number of decimal places to round to
         * @returns {number}
         */
        roundOff: function (value, places) {
            var flValue = util.isNumber(value) ? value : this.forceFloat(value || '0');
            if (!flValue || isNaN(flValue)) return 0;

            places = util.isNumber(places) ? places : 2;
            var multiplier = Math.pow(10, places);

            return Math.round(flValue * multiplier) / multiplier;
        },

        /**
         * Attempts to execute an array of functions, returns true if any succeed.
         * @param {Array<Function>} arrTasks - Array of functions
         * @returns {boolean}
         */
        tryThese: function (arrTasks) {
            var logTitle = [LogTitle, 'tryThese'].join('::');
            if (!arrTasks) return false;

            for (var i = 0; i < arrTasks.length; i++) {
                var task = arrTasks[i],
                    returnVal = false,
                    isSuccess = false;
                try {
                    returnVal = task.call();
                    if (returnVal || isSuccess) break;
                } catch (e) {
                    CTC_UTIL.logError(logTitle, e);
                }
                if (isSuccess) break;
            }
            return true;
        }
    });

    // DATE FUNCTIONS
    util.extend(CTC_UTIL, {
        /**
         * Gets the company date format from cache or NetSuite config.
         * @returns {string}
         */
        getDateFormat: function () {
            var logTitle = [LogTitle, 'getDateFormat'].join('::');
            var dateFormat = CTC_UTIL.CACHE.DATE_FORMAT;

            if (!dateFormat) {
                CTC_UTIL.tryThese([
                    function () {
                        var generalPref = ns_config.load({
                            type: ns_config.Type.COMPANY_PREFERENCES
                        });
                        dateFormat = generalPref.getValue({ fieldId: 'DATEFORMAT' });
                        return true;
                    },
                    function () {
                        dateFormat = nlapiGetContext().getPreference('DATEFORMAT');
                        return true;
                    }
                ]);
            }

            CTC_UTIL.CACHE.DATE_FORMAT = dateFormat;

            return dateFormat;
        },

        /**
         * Parses a date string to a JavaScript Date object using momentLib.
         * @param {string} dateStr - Date string
         * @param {string} [parseformat] - Optional format
         * @returns {Date|string}
         */
        parseToNSDate: function (dateStr, parseformat) {
            var logTitle = [LogTitle, 'parseToNSDate'].join('::');
            if (!dateStr || dateStr == 'NA') return 'NA';

            CTC_GLOBAL.GLOBAL.DATE_FORMAT = CTC_UTIL.getDateFormat();

            var dateValue = momentLib(
                dateStr,
                parseformat || CTC_GLOBAL.GLOBAL.DATE_FORMAT
            ).toDate();

            var returnDate = dateValue;

            return returnDate;
        },

        /**
         * Parses a date string to VAR Connect format using momentLib.
         * @param {string} dateStr - Date string
         * @param {string} [parseformat] - Optional format
         * @returns {string}
         */
        parseToVCDate: function (dateStr, parseformat) {
            if (!dateStr || dateStr == 'NA') return 'NA';

            // try to update the date fornat
            CTC_GLOBAL.GLOBAL.DATE_FORMAT = CTC_UTIL.getDateFormat();

            // if CTC_GLOBAL.GLOBAL.DATE_FORMAT == 'DD-Mon-YYYY', change it to 'DD-MMM-YYYY'
            var format = CTC_GLOBAL.GLOBAL.DATE_FORMAT;
            if (format == 'DD-Mon-YYYY') {
                format = 'DD-MMM-YYYY';
            }

            return momentLib(dateStr, parseformat).format(format);
        },

        /**
         * Formats a date to NetSuite date string using momentLib and ns_format.
         * @param {Object|string} option - Date or options
         * @param {string} [parseformat] - Optional format
         * @returns {string}
         */
        formatToNSDate: function (option, parseformat) {
            var logTitle = [LogTitle, 'formatToNSDate'].join('::');

            CTC_GLOBAL.GLOBAL.DATE_FORMAT = CTC_UTIL.getDateFormat();

            var dateStr = util.isObject(option)
                ? option.date || option.value || option.dateObj
                : option;

            var dateObj = momentLib(
                dateStr,
                option.parseFormat || parseformat || CTC_GLOBAL.GLOBAL.DATE_FORMAT
            ).toDate();

            var returnDate = ns_format.format({
                value: dateObj,
                type: ns_format.Type.DATE
            });

            CTC_UTIL.log(logTitle, 'FORMAT DATE', {
                dateStr: dateStr,
                dateObj: dateObj,
                returnDate: returnDate
            });

            return returnDate;
        },

        /**
         * Parses a date string to a Date object using momentLib.
         * @param {string} dateStr - Date string
         * @param {string} [format] - Optional format
         * @returns {Date|null}
         */
        momentParse: function (dateStr, format) {
            if (!format) format = CTC_GLOBAL.GLOBAL.DATE_FORMAT || this.getDateFormat();
            var returnVal;
            try {
                if (!dateStr || dateStr == 'NA') return null;
                returnVal = momentLib(dateStr, format).toDate();
            } catch (e) {
                CTC_UTIL.log('momentParse', '#error : ', e);
                // } finally {
                //     vc2_util.log('momentParse', '// ', [dateStr, format, returnVal]);
            }
            return returnVal;
        },

        /**
         * Parses a date string to NetSuite format.
         * @param {Object|string} option - Date string or options
         * @returns {string}
         */
        parseDate: function (option) {
            var logTitle = [LogTitle, 'parseDate'].join('::');

            var dateString = option.dateString || option,
                dateFormat = CTC_UTIL.CACHE.DATE_FORMAT,
                date = '';

            if (!dateFormat) {
                try {
                    require(['N/config'], function (config) {
                        var generalPref = config.load({
                            type: config.Type.COMPANY_PREFERENCES
                        });
                        dateFormat = generalPref.getValue({ fieldId: 'DATEFORMAT' });
                        return true;
                    });
                } catch (e) {}

                if (!dateFormat) {
                    try {
                        dateFormat = nlapiGetContext().getPreference('DATEFORMAT');
                    } catch (e) {}
                }
                CTC_UTIL.CACHE.DATE_FORMAT = dateFormat;
            }

            if (dateString && dateString.length > 0 && dateString != 'NA') {
                try {
                    var stringToProcess = dateString
                        .replace(/-/g, '/')
                        .replace(/\n/g, ' ')
                        .split(' ');

                    for (var i = 0; i < stringToProcess.length; i++) {
                        var singleString = stringToProcess[i];
                        if (singleString) {
                            var stringArr = singleString.split('T'); //handle timestamps with T
                            singleString = stringArr[0];
                            var convertedDate = new Date(singleString);

                            if (!date || convertedDate > date) date = convertedDate;
                        }
                    }
                } catch (e) {
                    CTC_UTIL.logError(logTitle, e);
                }
            }

            //Convert to string
            if (date) {
                //set date
                var year = date.getFullYear();
                if (year < 2000) {
                    year += 100;
                    date.setFullYear(year);
                }

                date = ns_format.format({
                    value: date,
                    type: dateFormat ? dateFormat : ns_format.Type.DATE
                });
            }

            // log.audit(
            //     logTitle,
            //     JSON.stringify({
            //         param: option,
            //         dateString: dateString,
            //         format: dateFormat,
            //         dateValue: date
            //     })
            // );

            return date;
        }
    });

    // WEB SERVICES
    util.extend(CTC_UTIL, {
        /**
         * Generates a serial link URL for viewing serials.
         * @param {Object} option - URL parameters
         * @returns {string}
         */
        generateSerialLink: function (option) {
            ns_url = ns_url || CTC_UTIL.loadModule('N/url') || CTC_UTIL.loadModuleNS('N/url');

            var protocol = 'https://';
            var domain = ns_url.resolveDomain({
                hostType: ns_url.HostType.APPLICATION
            });
            var linkUrl = ns_url.resolveScript({
                scriptId: CTC_GLOBAL.SCRIPT.VIEW_SERIALS_SL,
                deploymentId: CTC_GLOBAL.DEPLOYMENT.VIEW_SERIALS_SL,
                params: option
            });

            return protocol + domain + linkUrl;
        },

        /**
         * Converts a JSON object to a query string.
         * @param {Object} json - JSON object
         * @returns {string}
         */
        convertToQuery: function (json) {
            if (typeof json !== 'object') return;

            var qry = [];
            for (var key in json) {
                var qryVal = encodeURIComponent(json[key]),
                    qryKey = encodeURIComponent(key);
                qry.push([qryKey, qryVal].join('='));
            }

            return qry.join('&');
        },

        /**
         * Sends an HTTPS request using NetSuite N/https module.
         * @param {Object} option - Request options
         * @returns {Object}
         */
        sendRequest: function (option) {
            var logTitle = [LogTitle, 'sendRequest'].join('::'),
                returnValue = {};

            var VALID_RESP_CODE = [200, 207];

            var _DEFAULT = {
                validMethods: ['post', 'get'],
                maxRetries: 3,
                maxWaitMs: 3000
            };
            var ns_https = require('N/https');

            var queryOption = option.query || option.queryOption;
            if (!queryOption || CTC_UTIL.isEmpty(queryOption)) throw 'Missing query option';

            option.method = (option.method || 'get').toLowerCase();
            var response,
                responseBody,
                parsedResponse,
                param = {
                    noLogs: option.hasOwnProperty('noLogs') ? option.noLogs : false,
                    doRetry: option.hasOwnProperty('doRetry') ? option.doRetry : false,
                    retryCount: option.hasOwnProperty('retryCount') ? option.retryCount : 1,
                    responseType: option.hasOwnProperty('responseType')
                        ? option.responseType
                        : 'JSON',
                    maxRetry: option.hasOwnProperty('maxRetry')
                        ? option.maxRetry
                        : _DEFAULT.maxRetries || 0,

                    logHeader: option.header || logTitle,
                    logTranId: option.internalId || option.transactionId || option.recordId,
                    isXML: option.hasOwnProperty('isXML') ? !!option.isXML : false, // default json
                    isJSON: option.hasOwnProperty('isJSON') ? !!option.isJSON : true, // default json
                    waitMs: option.waitMs || _DEFAULT.maxWaitMs,
                    method: CTC_UTIL.inArray(option.method, _DEFAULT.validMethods)
                        ? option.method
                        : 'get'
                };
            if (option.isXML) param.isJSON = false;
            queryOption.method = param.method.toUpperCase();

            // log.audit(logTitle, '>> param: ' + JSON.stringify(param));
            var LOG_STATUS = CTC_GLOBAL.LIST.VC_LOG_STATUS;
            var startTime = new Date();
            try {
                if (!param.noLogs) {
                    CTC_UTIL.vcLog({
                        title: [param.logHeader, ' Request ', '(' + param.method + ')'].join(''),
                        content: queryOption,
                        transaction: param.logTranId,
                        status: LOG_STATUS.INFO
                    });
                }

                CTC_UTIL.log(
                    logTitle,
                    ['### REQUEST | ', param.logHeader, ' (' + param.method + ')'].join(''),
                    queryOption
                );
                returnValue.REQUEST = queryOption;

                /////////////////////////////////////////
                //// SEND THE REQUEST //////
                response = ns_https.request(queryOption);

                // ns_https[param.method](queryOption);
                returnValue.RESPONSE = response;
                /////////////////////////////////////////

                CTC_UTIL.log(logTitle, '>> RESPONSE ', {
                    duration: this.roundOff((new Date() - startTime) / 1000),
                    code: response.code || '-no response-',
                    body: response.body || '-empty response-'
                });

                if (!response || !response.body) {
                    throw 'Empty or Missing Response !';
                }
                responseBody = response.body;
                if (param.isJSON) {
                    parsedResponse = CTC_UTIL.safeParse(response);
                    returnValue.PARSED_RESPONSE = parsedResponse;
                }

                if (!response.code || !CTC_UTIL.inArray(response.code, VALID_RESP_CODE)) {
                    throw parsedResponse
                        ? JSON.stringify(parsedResponse)
                        : 'Received invalid response code - ' + response.code;
                }

                ////////////////////////////
            } catch (error) {
                var errorMsg = CTC_UTIL.extractError(error);
                returnValue.isError = true;
                returnValue.errorMsg = errorMsg;
                returnValue.error = error;
                returnValue.details = parsedResponse || response;

                CTC_UTIL.logError(logTitle, errorMsg);

                if (param.doRetry)
                    CTC_UTIL.log(
                        logTitle,
                        '## RETRY ##  -- ' + param.retryCount + '/' + param.maxRetry
                    );

                if (param.doRetry && param.maxRetry > param.retryCount) {
                    log.audit(logTitle, '... retrying in ' + param.waitMs);
                    option.retryCount = param.retryCount + 1;
                    CTC_UTIL.waitMs(param.waitMs);
                    returnValue = CTC_UTIL.sendRequest(option);
                }
            } finally {
                // vc2_util.log(logTitle, '>> RESPONSE time: ', {
                //     duration: this.roundOff((new Date() - startTime) / 1000)
                // });

                if (!param.noLogs) {
                    CTC_UTIL.vcLog({
                        title: [param.logHeader, 'Response'].join(' - '),
                        content: param.isJSON
                            ? JSON.stringify(parsedResponse || responseBody || response)
                            : responseBody,
                        transaction: param.logTranId,
                        status: LOG_STATUS.INFO
                    });
                }
            }

            return returnValue;
        },

        /**
         * Sends a Restlet request using NetSuite N/https module.
         * @param {Object} option - Request options
         * @returns {Object}
         */
        sendRequestRestlet: function (option) {
            var logTitle = [LogTitle, 'sendRequestRestlet'].join('::'),
                returnValue = {};

            var VALID_RESP_CODE = [200, 207];

            var _DEFAULT = {
                validMethods: ['post', 'get'],
                maxRetries: 3,
                maxWaitMs: 3000
            };
            var ns_https = require('N/https');

            var queryOption = option.query || option.queryOption;
            if (!queryOption || CTC_UTIL.isEmpty(queryOption)) throw 'Missing query option';

            option.method = (option.method || 'get').toLowerCase();

            var response,
                responseBody,
                parsedResponse,
                param = {
                    noLogs: option.hasOwnProperty('noLogs') ? option.noLogs : false,
                    doRetry: option.hasOwnProperty('doRetry') ? option.doRetry : false,
                    retryCount: option.hasOwnProperty('retryCount') ? option.retryCount : 1,
                    responseType: option.hasOwnProperty('responseType')
                        ? option.responseType
                        : 'JSON',
                    maxRetry: option.hasOwnProperty('maxRetry')
                        ? option.maxRetry
                        : _DEFAULT.maxRetries || 0,

                    logHeader: option.header || logTitle,
                    logTranId: option.internalId || option.transactionId || option.recordId,
                    isXML: option.hasOwnProperty('isXML') ? !!option.isXML : false, // default json
                    isJSON: option.hasOwnProperty('isJSON') ? !!option.isJSON : true, // default json
                    waitMs: option.waitMs || _DEFAULT.maxWaitMs,
                    method: CTC_UTIL.inArray(option.method, _DEFAULT.validMethods)
                        ? option.method
                        : 'get'
                };
            if (option.isXML) param.isJSON = false;
            queryOption.method = param.method.toUpperCase();

            // log.audit(logTitle, '>> param: ' + JSON.stringify(param));
            var LOG_STATUS = CTC_GLOBAL.LIST.VC_LOG_STATUS;
            var startTime = new Date();
            try {
                if (!param.noLogs) {
                    CTC_UTIL.vcLog({
                        title: [param.logHeader, ' Request ', '(' + param.method + ')'].join(''),
                        content: queryOption,
                        transaction: param.logTranId,
                        status: LOG_STATUS.INFO
                    });
                }

                log.audit(logTitle, '>> REQUEST: ' + JSON.stringify(queryOption));
                returnValue.REQUEST = queryOption;

                /////////////////////////////////////////
                //// SEND THE REQUEST //////
                response = ns_https.requestRestlet(queryOption);

                // ns_https[param.method](queryOption);
                returnValue.RESPONSE = response;
                /////////////////////////////////////////

                log.audit(
                    logTitle,
                    '>> RESPONSE ' +
                        JSON.stringify({
                            duration: this.roundOff((new Date() - startTime) / 1000),
                            code: response.code || '-no response-',
                            body: response.body || '-empty response-'
                        })
                );

                if (!response || !response.body) throw 'Empty or Missing Response !';

                responseBody = response.body;
                if (param.isJSON) {
                    parsedResponse = CTC_UTIL.safeParse(response);
                    returnValue.PARSED_RESPONSE = parsedResponse;
                }

                if (!response.code || !CTC_UTIL.inArray(response.code, VALID_RESP_CODE)) {
                    throw parsedResponse
                        ? JSON.stringify(parsedResponse)
                        : 'Received invalid response code - ' + response.code;
                }

                ////////////////////////////
            } catch (error) {
                var errorMsg = CTC_UTIL.extractError(error);
                returnValue.isError = true;
                returnValue.errorMsg = errorMsg;
                returnValue.error = error;
                returnValue.details = parsedResponse || response;

                CTC_UTIL.logError(logTitle, errorMsg);

                if (param.doRetry)
                    CTC_UTIL.log(
                        logTitle,
                        '## RETRY ##  -- ' + param.retryCount + '/' + param.maxRetry
                    );

                if (param.doRetry && param.maxRetry > param.retryCount) {
                    log.audit(logTitle, '... retrying in ' + param.waitMs);
                    option.retryCount = param.retryCount + 1;
                    CTC_UTIL.waitMs(param.waitMs);
                    returnValue = CTC_UTIL.sendRequestRestlet(option);
                }
            } finally {
                CTC_UTIL.log(logTitle, '>> RESPONSE time: ', {
                    duration: this.roundOff((new Date() - startTime) / 1000)
                });

                if (!param.noLogs) {
                    CTC_UTIL.vcLog({
                        title: [param.logHeader, 'Response'].join(' - '),
                        content: param.isJSON
                            ? JSON.stringify(parsedResponse || responseBody || response)
                            : responseBody,
                        transaction: param.logTranId,
                        status: LOG_STATUS.INFO
                    });
                }
            }

            return returnValue;
        },

        /**
         * Sends a service request to VAR Connect Restlet.
         * @param {Object} option - Service request options
         * @returns {Object}
         */
        serviceRequest: function (option) {
            var requestOption = {},
                serviceQuery = option.query || option;

            if (option.query) requestOption = option;
            if (option.moduleName || option.action) serviceQuery = option;

            // build the serviceQuery
            util.extend(requestOption, {
                method: 'POST',
                isJSON: true
            });
            requestOption.query = {
                scriptId: CTC_GLOBAL.SCRIPT.SERVICES_RL.SCRIPT_ID,
                deploymentId: CTC_GLOBAL.SCRIPT.SERVICES_RL.DEPLOY_ID,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serviceQuery)
            };

            return CTC_UTIL.sendRequestRestlet(requestOption);
        },

        /**
         * Safely parses a JSON response.
         * @param {Object|string} response - Response to parse
         * @returns {*}
         */
        safeParse: function (response) {
            var logTitle = [LogTitle, 'safeParse'].join('::'),
                returnValue;
            try {
                returnValue = JSON.parse(response.body || response);
            } catch (error) {
                log.audit(logTitle, '## ' + CTC_UTIL.extractError(error));
                returnValue = null;
            }

            return returnValue;
        },

        /**
         * Handles a response, parsing as JSON or XML.
         * @param {Object} request - Response object
         * @param {string} responseType - 'JSON' or 'XML'
         * @returns {*}
         */
        handleResponse: function (request, responseType) {
            return responseType == 'JSON'
                ? this.handleJSONResponse(request)
                : this.handleXMLResponse(request);
        },

        /**
         * Handles a JSON response, throws error if present.
         * @param {Object} requestObj - Response object
         */
        handleJSONResponse: function (requestObj) {
            var logTitle = [LogTitle, 'handleJSONResponse'].join(':'),
                returnValue = requestObj,
                errorResponse = {
                    code: requestObj.RESPONSE ? requestObj.RESPONSE.code : null
                };

            var parsedResp = requestObj.PARSED_RESPONSE;
            if (!requestObj.isError) return;
            util.extend(errorResponse, {
                details: requestObj.error,
                message: (function () {
                    return !parsedResp
                        ? 'Unable to parse the response'
                        : parsedResp.fault && parsedResp.fault.faultstring
                          ? parsedResp.fault.faultstring
                          : parsedResp.error && parsedResp.error_description
                            ? parsedResp.error_description
                            : parsedResp.message;
                })()
            });

            // check if we can parse the details
            if (util.isObject(requestObj.details)) {
                if (requestObj.details.errors && util.isArray(requestObj.details.errors)) {
                    errorResponse.details = requestObj.details.errors
                        .map(function (err) {
                            if (err.fields && util.isArray(err.fields)) {
                                return err.fields
                                    .map(function (field) {
                                        return [field.id, field.message].join(': ');
                                    })
                                    .join(', ');
                            }
                        })
                        .join(', ');
                } else if (requestObj.details.status && requestObj.details.title) {
                    errorResponse.details = requestObj.details.title;
                }
            }

            throw errorResponse;
        },

        /**
         * Handles an XML response, throws error if present.
         * @param {Object} request - Response object
         * @returns {Object}
         */
        handleXMLResponse: function (request) {
            var logTitle = [LogTitle, 'handleXMLResponse'].join(':'),
                returnValue = request;

            if (request.isError && request.errorMsg) throw request.errorMsg;

            if (!request.RESPONSE || !request.RESPONSE.body)
                throw 'Invalid or missing XML response';

            ns_xml = ns_xml || CTC_UTIL.loadModule('N/xml') || CTC_UTIL.loadModuleNS('N/xml');

            var xmlResponse = request.RESPONSE.body,
                xmlDoc = ns_xml.Parser.fromString({ text: xmlResponse });
            if (!xmlDoc) throw 'Unable to parse XML response';

            // Failure-Message ( D&H )
            var respStatus = CTC_UTIL.getNodeContent(
                ns_xml.XPath.select({ node: xmlDoc, xpath: '//STATUS' })
            );

            if (respStatus && CTC_UTIL.inArray(respStatus.toUpperCase(), ['FAILURE'])) {
                var respStatusMessage = CTC_UTIL.getNodeContent(
                    ns_xml.XPath.select({ node: xmlDoc, xpath: '//MESSAGE' })
                );

                throw respStatusMessage || 'Unexpected failure';
            }

            // ERROR DETAIL - Synnex
            var respErrorDetail = CTC_UTIL.getNodeContent(
                ns_xml.XPath.select({ node: xmlDoc, xpath: '//ErrorDetail' })
            );
            if (respErrorDetail) throw respErrorDetail;

            //OrderInfo/ErrorMsg - TechData
            var respErrorInfo =
                CTC_UTIL.getNodeContent(
                    ns_xml.XPath.select({ node: xmlDoc, xpath: '//OrderInfo/ErrorMsg' })
                ) ||
                CTC_UTIL.getNodeContent(ns_xml.XPath.select({ node: xmlDoc, xpath: '//ErrorMsg' }));
            if (respErrorInfo) throw respErrorInfo;

            return returnValue;
        },

        /**
         * Gets text content from an XML node.
         * @param {Object} node - XML node
         * @returns {string}
         */
        getNodeTextContent: function (node) {
            var textContent;
            try {
                if (!node) return null;

                if (node.textContent) {
                    textContent = node.textContent;
                } else if (
                    node.length &&
                    (typeof node.shift === 'function' || typeof node.slice === 'function')
                ) {
                    var firstNode = node[0];
                    textContent = firstNode ? firstNode.textContent : null;
                } else if (Array.isArray(node) && node.length > 0) {
                    textContent = node[0].textContent;
                }
            } catch (err) {
                CTC_UTIL.logWarn('getNodeTextContent', err);
            }
            return textContent;
        },

        /**
         * Gets content from an XML node array.
         * @param {Array} node - XML node array
         * @returns {*}
         */
        getNodeContent: function (node) {
            var returnValue;
            if (node && node.length) returnValue = (node[0] && node[0].textContent) || undefined;

            return returnValue;
        }
    });

    // LOGS, ERROR HANDLING
    util.extend(CTC_UTIL, {
        /**
         * Handles an error (placeholder).
         * @param {*} error - Error object
         * @param {string} logTitle - Log title
         */
        handleError: function (error, logTitle) {},

        /**
         * Gets remaining usage units for current script.
         * @returns {string}
         */
        getUsage: function () {
            var REMUSAGE = ns_runtime.getCurrentScript().getRemainingUsage();
            return '[usage:' + REMUSAGE + '] ';
        },

        /**
         * Extracts error message from an error object or string.
         * @param {*} option - Error object or string
         * @returns {string}
         */
        extractError: function (option) {
            option = option || {};
            var errorMessage = util.isString(option)
                ? option
                : option.message || option.error || JSON.stringify(option);

            if (!errorMessage || !util.isString(errorMessage))
                errorMessage = 'Unexpected Error occurred';

            return errorMessage;
        },

        /**
         * Logs a message to VC Log record.
         * @param {Object} option - Log options
         * @returns {boolean}
         */
        vcLog: function (option) {
            var logTitle = [LogTitle, 'vcLog'].join('::');

            var VC_LOG = CTC_GLOBAL.RECORD.VC_LOG,
                LOG_STATUS = CTC_GLOBAL.LIST.VC_LOG_STATUS;

            try {
                var logOption = {},
                    batchTransaction = option.batch,
                    isBatched = batchTransaction != null;

                logOption.DATE = new Date();
                logOption.APPLICATION = option.appName || CTC_GLOBAL.LOG_APPLICATION;
                logOption.HEADER = option.title || logOption.APPLICATION;
                logOption.BODY = option.body || option.content || option.message || option.details;
                logOption.STATUS =
                    option.logStatus ||
                    option.status ||
                    (option.isSuccess ? LOG_STATUS.SUCCESS : LOG_STATUS.INFO);

                logOption.TRANSACTION =
                    option.recordId || option.transaction || option.id || option.internalid || '';

                if (option.successMsg) {
                    logOption.BODY = option.successMsg;
                    logOption.STATUS = LOG_STATUS.SUCCESS;
                } else if (option.error) {
                    var errorMsg = CTC_UTIL.extractError(option.error);
                    logOption.BODY = errorMsg;

                    logOption.STATUS = option.error.logStatus || option.status || LOG_STATUS.ERROR;
                    if (option.error.details) option.details = option.error.details;
                } else if (option.warning) {
                    logOption.BODY = option.warning;
                    logOption.STATUS = LOG_STATUS.WARN;
                }

                if (option.details) {
                    logOption.HEADER = option.title
                        ? [option.title, logOption.BODY].join(' - ')
                        : logOption.BODY;
                    logOption.BODY = option.details;
                }

                // vc2_util.log(
                //     logOption.HEADER,
                //     vc2_util.getKeysFromValues({ source: LOG_STATUS, value: logOption.STATUS }) +
                //         ' : ',
                //     logOption.BODY
                // );

                logOption.BODY = util.isString(logOption.BODY)
                    ? logOption.BODY
                    : JSON.stringify(logOption.BODY);

                if (logOption.BODY && logOption.BODY.length > 1000000) {
                    logOption.BODY = logOption.BODY.slice(0, 999997) + '...';
                }
                if (logOption.HEADER && logOption.HEADER.length > 300) {
                    logOption.HEADER = logOption.HEADER.slice(0, 300);
                }

                if (isBatched) {
                    var VC_LOG_BATCH = CTC_GLOBAL.RECORD.VC_LOG_BATCH;
                    var batchOption = {
                        TRANSACTION: batchTransaction
                    };
                    // create the log as an inline item
                    var recBatch =
                        this._batchedVCLogs[batchTransaction] ||
                        ns_record.create({ type: VC_LOG_BATCH.ID });
                    for (var field in VC_LOG_BATCH.FIELD) {
                        var fieldName = VC_LOG_BATCH.FIELD[field];
                        recBatch.setValue({
                            fieldId: fieldName,
                            value: batchOption[field] || ''
                        });
                    }
                    var sublistId = ['recmach', VC_LOG.FIELD.BATCH].join(''),
                        line = recBatch.getLineCount({
                            sublistId: sublistId
                        });
                    for (var column in VC_LOG.FIELD) {
                        var columnName = VC_LOG.FIELD[column];
                        recBatch.setSublistValue({
                            sublistId: sublistId,
                            fieldId: columnName,
                            line: line,
                            value: logOption[column] || ''
                        });
                    }
                    this._batchedVCLogs[batchTransaction] = recBatch;
                } else {
                    // create the log
                    var recLog = ns_record.create({ type: VC_LOG.ID });
                    for (var field in VC_LOG.FIELD) {
                        var fieldName = VC_LOG.FIELD[field];
                        recLog.setValue({
                            fieldId: fieldName,
                            value: logOption[field] || ''
                        });
                    }
                    recLog.save();
                }
            } catch (error) {
                log.error(logTitle, this.LogPrefix + '## ERROR ## ' + CTC_UTIL.extractError(error));
            }
            return true;
        },

        /**
         * Logs an error to VC Log record.
         * @param {Object} option - Log options
         * @returns {boolean}
         */
        vcLogError: function (option) {
            var logTitle = [LogTitle, ''].join(':'),
                returnValue = true;

            var logOption = option;

            // check for logStatus, error, title and details
            // if there are details, move all the error to the title
            if (option.details) {
                logOption.body = option.details;
                logOption.title = [
                    option.title,
                    option.errorMsg || option.error || CTC_UTIL.extractError(option.error)
                ].join(' - ');
            }
            logOption.status = option.status || CTC_GLOBAL.LIST.VC_LOG_STATUS.ERROR; // common error

            return this.vcLog(logOption);
        },
        _batchedVCLogs: {},

        /**
         * Submits a batch of VC Logs.
         * @param {string} batchTransaction - Batch transaction ID
         */
        submitVCLogBatch: function (batchTransaction) {
            var logTitle = [LogTitle, 'submitVCLogBatch'].join('::');
            var recBatch = this._batchedVCLogs[batchTransaction];
            if (recBatch) {
                var VC_LOG = CTC_GLOBAL.RECORD.VC_LOG,
                    sublistId = ['recmach', VC_LOG.FIELD.BATCH].join('');
                var lineCount = recBatch.getLineCount({
                    sublistId: sublistId
                });
                if (lineCount > 0) {
                    recBatch.save();
                    log.audit(logTitle, 'VC Logs submitted for batch ' + batchTransaction);
                } else {
                    recBatch = null;
                }
            }
            if (!recBatch) {
                log.debug(logTitle, 'No VC Logs to submit for batch ' + batchTransaction);
            }
        },
        LogPrefix: null,

        /**
         * Logs a message using NetSuite log module.
         * @param {string} logTitle - Log title
         * @param {string|Object} msg - Message
         * @param {*} objvar - Additional object
         * @returns {boolean}
         */
        log: function (logTitle, msg, objvar) {
            var logMsg = msg,
                logType = 'audit',
                logPrefx = this.LogPrefix || '';

            try {
                if (!util.isString(msg)) {
                    logMsg = msg.msg || msg.text || msg.content || '';
                    logPrefx = msg.prefix || msg.prfx || msg.pre || logPrefx;
                    logType = msg.type || 'audit';
                }

                log[logType || 'audit'](
                    logTitle,
                    CTC_UTIL.getUsage() +
                        (logPrefx ? logPrefx + ' ' : '') +
                        logMsg +
                        (!CTC_UTIL.isEmpty(objvar) ? JSON.stringify(objvar) : '')
                );
            } catch (error) {
                log.error('LOG ERROR', CTC_UTIL.extractError(error));
            }

            return true;
        },

        /**
         * Logs a warning message.
         * @param {string} logTitle - Log title
         * @param {*} warnMsg - Warning message
         */
        logWarn: function (logTitle, warnMsg) {
            CTC_UTIL.log(logTitle, { type: 'audit', msg: '[WARNING] : ' }, warnMsg);
            return;
        },

        /**
         * Logs an exception message.
         * @param {string} logTitle - Log title
         * @param {*} exceptionMsg - Exception message
         */
        logException: function (logTitle, exceptionMsg) {
            CTC_UTIL.log(logTitle, { type: 'audit', msg: '[EXCEPTION] : ' }, exceptionMsg);
            return;
        },

        /**
         * Logs a trace message.
         * @param {string} logTitle - Log title
         * @param {string} traceMsg - Trace message
         * @param {*} traceVar - Additional object
         */
        logTrace: function (logTitle, traceMsg, traceVar) {
            CTC_UTIL.log(logTitle, { type: 'trace', msg: '[TRACE] : ' + traceMsg }, traceVar);
            return;
        },

        /**
         * Logs an error message.
         * @param {string} logTitle - Log title
         * @param {*} errorMsg - Error message
         */
        logError: function (logTitle, errorMsg) {
            CTC_UTIL.log(logTitle, { type: 'error', msg: '[ERROR] :  ' }, errorMsg);
            return;
        },

        /**
         * Logs a debug message.
         * @param {string} logTitle - Log title
         * @param {string|Object} msg - Debug message
         * @param {*} msgVar - Additional object
         */
        logDebug: function (logTitle, msg, msgVar) {
            var msgObj = util.isString(msg) ? { msg: msg } : msg;
            msgObj.type = 'debug';

            CTC_UTIL.log(logTitle, msgObj, msgVar);
            return;
        },

        /**
         * Dumps all fields of an object to log.
         * @param {string} logTitle - Log title
         * @param {Object} dumpObj - Object to dump
         * @param {string} [prefix] - Optional prefix
         */
        dumpLog: function (logTitle, dumpObj, prefix) {
            for (var fld in dumpObj) {
                CTC_UTIL.log(logTitle, [prefix || '', ':', fld].join('') + ' ', dumpObj[fld]);
            }
            return;
        },

        /**
         * Prints a formatted success log for record actions.
         * @param {Object} option - Log options
         * @returns {string}
         */
        printSuccessLog: function (option) {
            var logTitle = [LogTitle, 'printSuccessLog'].join('::'),
                returnValue;

            var successMsg = [],
                recordType = option.recordType || 'Item Fulfillment',
                recordId = option.recordId,
                recordAction = option.recordAction || 'Created';

            successMsg.push(
                'Successfully ' +
                    recordAction.toLowerCase() +
                    ':  ' +
                    (recordType + ' [' + recordId + ']')
            );
            (option.lines || []).forEach(function (lineData, idx) {
                successMsg.push('\nLine #' + (idx + 1) + ': ');
                for (var lineKey in lineData) {
                    successMsg.push('  ' + lineKey + ': ' + lineData[lineKey]);
                }
            });

            returnValue = successMsg.join('\n');

            return returnValue;
        }
    });

    // NS API
    util.extend(CTC_UTIL, {
        /**
         * Runs a paged NetSuite search and returns all results.
         * @param {Object} option - Search options
         * @returns {Array}
         */
        searchAllPaged: function (option) {
            var objSearch,
                arrResults = [],
                logTitle = [LogTitle, 'searchAllPaged'].join('::');
            option = option || {};

            try {
                var searchId = option.id || option.searchId;
                var searchType = option.recordType || option.type;

                objSearch = option.searchObj
                    ? option.searchObj
                    : searchId
                      ? ns_search.load({
                            id: searchId
                        })
                      : searchType
                        ? ns_search.create({
                              type: searchType
                          })
                        : null;

                if (!objSearch) throw 'Invalid search identifier';
                if (!objSearch.filters) objSearch.filters = [];
                if (!objSearch.columns) objSearch.columns = [];

                if (option.filters) objSearch.filters = objSearch.filters.concat(option.filters);
                if (option.filterExpression) objSearch.filterExpression = option.filterExpression;
                if (option.columns) objSearch.columns = objSearch.columns.concat(option.columns);

                var maxResults = option.maxResults || 0;
                var pageSize = maxResults && maxResults <= 1000 ? maxResults : 1000;

                // run the search
                var objPagedResults = objSearch.runPaged({
                    pageSize: pageSize
                });
                // set the max results to the search length, if not defined;
                maxResults = maxResults || objPagedResults.count;

                for (var i = 0, j = objPagedResults.pageRanges.length; i < j; i++) {
                    var pagedResults = objPagedResults.fetch({
                        index: objPagedResults.pageRanges[i].index
                    });

                    // test if we need to get all the paged results,
                    // .. or just a slice, of maxResults is less than the pageSize
                    arrResults = arrResults.concat(
                        maxResults > pageSize
                            ? pagedResults.data
                            : pagedResults.data.slice(0, maxResults)
                    );

                    // reduce the max results
                    maxResults = maxResults - pageSize;
                    if (maxResults < 0) break;
                }
            } catch (e) {
                log.debug(logTitle, '>> error: ' + JSON.stringify(e));
                throw e.message;
            }

            return arrResults;
        },

        /**
         * Checks if OneWorld feature is enabled.
         * @returns {boolean}
         */
        isOneWorld: function () {
            return ns_runtime.isFeatureInEffect({ feature: 'Subsidiaries' });
        },

        /**
         * Performs a flat lookup of fields using NetSuite search.
         * @param {Object} option - Lookup options
         * @returns {Object}
         */
        flatLookup: function (option) {
            var arrData = null,
                arrResults = null;

            arrResults = ns_search.lookupFields(option);

            if (arrResults) {
                arrData = {};
                for (var fld in arrResults) {
                    arrData[fld] = util.isArray(arrResults[fld])
                        ? arrResults[fld][0]
                        : arrResults[fld];
                }
            }
            return arrData;
        },

        /**
         * Gets all results from a NetSuite search object.
         * @param {Object} searchObject - NetSuite search object
         * @returns {Array}
         */
        searchGetAllResult: function (searchObject) {
            var arrResults = [],
                pagedResults = searchObject.runPaged();

            pagedResults.pageRanges.forEach(function (pageRange) {
                arrResults = arrResults.concat(pagedResults.fetch({ index: pageRange.index }).data);
            });

            return arrResults;
        }
    });

    // OBJECT/ARRAY UTILS
    util.extend(CTC_UTIL, {
        /**
         * Extends a source object with another object.
         * @param {Object} source - Source object
         * @param {Object} contrib - Object to extend with
         * @returns {Object}
         */
        extend: function (source, contrib) {
            // do this to preserve the source values
            return util.extend(util.extend({}, source), contrib);
        },

        /**
         * Removes null values from an object.
         * @param {Object} option - Object to clean
         * @returns {Object}
         */
        removeNullValues: function (option) {
            var newObj = {};
            if (!option || CTC_UTIL.isEmpty(option) || !util.isObject(option)) return newObj;

            for (var prop in option) {
                if (option[prop] === null) continue;
                newObj[prop] = option[prop];
            }

            return newObj;
        },

        /**
         * Copies values from contrib to source, with options.
         * @param {Object} source - Source object
         * @param {Object} contrib - Object to copy from
         * @param {Object} [option] - Options
         * @returns {boolean|Object}
         */
        copyValues: function (source, contrib, option) {
            option = option || {};
            if (!util.isObject(source) || !util.isObject(contrib)) return false;

            var onlyNullValues = option.onlyNullValues || false,
                overwriteSource = option.overwriteSource || false;

            var newSource = overwriteSource ? source : util.extend({}, source);

            for (var fld in contrib) {
                var value = contrib[fld];

                if (!newSource.hasOwnProperty(fld) || newSource[fld] == null) {
                    newSource[fld] = value;
                }

                if (onlyNullValues) continue;
                newSource[fld] = value;
            }

            return newSource;
        },

        /**
         * Deep clones an object using JSON serialization.
         * @param {Object} obj - Object to clone
         * @returns {Object}
         */
        clone: function (obj) {
            return JSON.parse(JSON.stringify(obj));
        },

        /**
         * Finds matching items in a data source based on filter.
         * @param {Object} option - Options with dataSource, filter, findAll
         * @returns {Array|Object|boolean}
         */
        findMatching: function (option) {
            var logTitle = [LogTitle, 'findMatching'].join('::'),
                returnValue;

            // Sets dataSource with either option.dataSource or option.dataSet or option.list
            var dataSource = option.dataSource || option.dataSet || option.list,
                // Set filter to the value of option.filter
                filter = option.filter,
                //  If dataSource is empty or not an array, return false
                findAll = option.findAll;

            if (CTC_UTIL.isEmpty(dataSource) || !util.isArray(dataSource)) return false;

            // Initializes an empty array
            var arrResults = [];

            // Loops throught the dataSource array
            for (var i = 0, j = dataSource.length; i < j; i++) {
                var isFound = true;

                // Loops through the keys of the filter object
                for (var fld in filter) {
                    // If current value is a function, set isFound to the result of calling it with dataSource[i][fld] as an argument, otherwise compare it to filter[fld]
                    isFound = util.isFunction(filter[fld])
                        ? filter[fld].call(dataSource[i], dataSource[i][fld])
                        : dataSource[i][fld] == filter[fld];

                    // If isFound is false, breaks loop
                    if (!isFound) break;
                }

                // If every key-value pair from the filter object was found on the element being inspected, push that element to arrResults. If findAll is false, break the loop.
                if (isFound) {
                    arrResults.push(dataSource[i]);
                    if (!findAll) break;
                }
            }

            //If array of results is not empty, set valueOfReturn to its first element or array itself depending on findAll flag. Otherwise, set it to false
            returnValue =
                arrResults && arrResults.length
                    ? findAll
                        ? arrResults
                        : arrResults.shift()
                    : false;

            // Return value stored in returnValue variable
            return returnValue;
        },

        /**
         * Extracts specified fields from a source object.
         * @param {Object} option - Options with source and params
         * @returns {Object|boolean}
         */
        extractValues: function (option) {
            var logTitle = [LogTitle, 'extractValues'].join('::'),
                returnValue;

            var sourceObj = option.source || option.sourceObj;
            var params = option.params || option.fields;

            if (this.isEmpty(sourceObj) || this.isEmpty(params)) return false;
            if (!util.isObject(sourceObj) && !util.isArray(params)) return false;

            returnValue = {};

            for (var i = 0, j = params.length; i < j; i++) {
                if (!params[i]) continue;
                returnValue[params[i]] = sourceObj[params[i]];
            }

            return returnValue;
        },

        /**
         * Gets all keys from an object as an array.
         * @param {Object} option - Object to get keys from
         * @returns {Array|boolean}
         */
        arrayKeys: function (option) {
            var logTitle = [LogTitle, 'arrayKeys'].join('::'),
                returnValue = [];

            if (CTC_UTIL.isEmpty(option)) return false;

            for (var fld in option) {
                if (!CTC_UTIL.inArray(fld, returnValue)) returnValue.push(fld);
            }

            return returnValue;
        },

        /**
         * Gets all values from an object as an array.
         * @param {Object} option - Object to get values from
         * @returns {Array|boolean}
         */
        arrayValues: function (option) {
            var logTitle = [LogTitle, 'arrayValues'].join('::'),
                returnValue = [];
            if (CTC_UTIL.isEmpty(option)) return false;

            for (var fld in option) {
                if (!CTC_UTIL.inArray(option[fld], returnValue)) returnValue.push(option[fld]);
            }

            return returnValue;
        },

        /**
         * Gets keys from an object whose values match specified values.
         * @param {Object} option - Options with source and value
         * @returns {Array|boolean}
         */
        getKeysFromValues: function (option) {
            var logTitle = [LogTitle, 'getKeyValues'].join('::'),
                returnValue;

            var sourceObj = option.source || option.sourceObj,
                values = option.value || option.values;

            if (
                CTC_UTIL.isEmpty(sourceObj) ||
                CTC_UTIL.isEmpty(values) ||
                !util.isObject(sourceObj) ||
                (!util.isArray(values) && !util.isString(values))
            )
                return false;

            if (!util.isArray(values)) values = [values];

            returnValue = [];
            for (var fld in sourceObj) {
                if (
                    CTC_UTIL.inArray(sourceObj[fld], values) &&
                    !CTC_UTIL.inArray(fld, returnValue)
                ) {
                    returnValue.push(fld);
                }
            }

            return returnValue;
        },

        /**
         * Gets values from an object whose keys match specified keys.
         * @param {Object} option - Options with source and keys
         * @returns {Array|boolean}
         */
        getValuesFromKeys: function (option) {
            var logTitle = [LogTitle, 'getValuesFromKeys'].join('::'),
                returnValue;

            var sourceObj = option.source || option.sourceObj,
                params = option.params || option.keys;

            if (
                CTC_UTIL.isEmpty(sourceObj) ||
                CTC_UTIL.isEmpty(params) ||
                !util.isObject(sourceObj) ||
                (!util.isArray(params) && !util.isString(params))
            )
                return false;

            if (!util.isArray(params)) params = [params];

            returnValue = [];
            for (var fld in sourceObj) {
                if (
                    CTC_UTIL.inArray(fld, params) &&
                    !CTC_UTIL.inArray(sourceObj[fld], returnValue)
                ) {
                    returnValue.push(sourceObj[fld]);
                }
            }

            return returnValue;
        },

        /**
         * Slices an array into chunks of specified size.
         * @param {Array} array - Array to chunk
         * @param {number} chunkSize - Size of each chunk
         * @returns {Array}
         */
        sliceArrayIntoChunks: function (array, chunkSize) {
            var chunks = [];
            for (var i = 0; i < array.length; i += chunkSize) {
                var chunk = array.slice(i, i + chunkSize);
                chunks.push(chunk);
            }
            return chunks;
        },

        /**
         * Returns a unique array (removes duplicates).
         * @param {Array} arrVar - Array to process
         * @returns {Array}
         */
        uniqueArray: function (arrVar) {
            var arrNew = [];
            for (var i = 0, j = arrVar.length; i < j; i++) {
                if (CTC_UTIL.inArray(arrVar[i], arrNew)) continue;
                arrNew.push(arrVar[i]);
            }

            return arrNew;
        }
    });

    // FILE CABINET
    util.extend(CTC_UTIL, {
        /**
         * Gets the current folder for file operations.
         * @param {Object} option - Options for folder lookup
         * @returns {*}
         */
        getCurrentFolder: function (option) {
            var returnValue = null,
                logTitle = [LogTitle, 'getCurrentFolder'].join('::');
            option = option || {};

            try {
                var cacheKey = ['FileLib.getCurrentFolder', JSON.stringify(option)].join('::');
                returnValue = this.CACHE[cacheKey];

                if (this.isEmpty(this.CACHE[cacheKey]) || option.noCache == true) {
                    var scriptId = option.scriptId;
                    if (!scriptId) {
                        if (!option.currentScript) {
                            if (!option.runtime) option.runtime = this.loadModule('N/runtime');
                            option.currentScript = option.runtime.getCurrentScript();
                        }
                        scriptId = option.currentScript.id;
                    }
                    if (!scriptId) return false;

                    var objSearch = ns_search.create({
                        type: 'script',
                        filters: [['scriptid', 'is', scriptId]],
                        columns: ['scriptfile', 'name']
                    });

                    var fileId = null;
                    objSearch.run().each(function (row) {
                        fileId = row.getValue('scriptfile');
                        return true;
                    });

                    var ns_file = this.loadModule('N/file');
                    var fileObj = ns_file.load({
                        id: fileId
                    });

                    // get the actual folderPathj
                    var folderInfo = {
                        path: (function (path) {
                            var pathNew = path.split('/');
                            pathNew.pop();
                            return pathNew.join('/');
                        })(fileObj.path),
                        id: fileObj.folder
                    };

                    log.audit(logTitle, folderInfo);

                    returnValue = folderInfo;
                    this.CACHE[cacheKey] = folderInfo;
                }
            } catch (e) {
                log.error(logTitle, JSON.stringify(e));
            } finally {
                // log.debug(logTitle, '>> current folder: ' + returnValue);
            }

            return returnValue;
        },

        /**
         * Searches for a file in NetSuite File Cabinet.
         * @param {Object} option - Search options
         * @returns {*}
         */
        searchFile: function (option) {
            var fileName = option.filename || option.name;
            if (!fileName) return false;

            var arrCols = [
                'name',
                'folder',
                'documentsize',
                'url',
                'created',
                'modified',
                'filetype'
            ];
            var searchOption = {
                type: 'file',
                columns: arrCols,
                filters: [['name', 'is', fileName]]
            };

            var folderId = option.folder || option.folderId;
            if (folderId) {
                searchOption.filters.push('AND');
                searchOption.filters.push(['folder', 'is', folderId]);
            }

            var returnValue = null;

            var cacheKey = ['FileLib.searchFile', JSON.stringify(searchOption)].join('::');
            var fileInfo = this.CACHE[cacheKey];

            if (this.isEmpty(this.CACHE[cacheKey]) || option.noCache == true) {
                var objSearch = ns_search.create(searchOption);
                fileInfo = []; // prepare for multiple results?
                objSearch.run().each(function (row) {
                    var fInfo = {};

                    for (var i = 0, j = row.columns.length; i < j; i++) {
                        var col = row.columns[i];
                        fInfo[col.name] = row.getValue(col);
                    }
                    fInfo.folderName = row.getText({
                        name: 'folder'
                    });
                    fInfo.id = row.id;

                    fileInfo.push(fInfo);
                    return true;
                });

                this.CACHE[cacheKey] = fileInfo;
            }

            returnValue =
                option.doReturnArray && option.doReturnArray === true ? fileInfo : fileInfo.shift();

            return returnValue;
        },

        /**
         * Gets the content of a file from NetSuite File Cabinet.
         * @param {Object} option - Options with fileId
         * @returns {*}
         */
        getFileContent: function (option) {
            var returnValue = null;
            var logTitle = [LogTitle, 'getFileContent'];

            try {
                var fileId = option.fileId;
                if (!fileId) {
                    var fileName = option.filename || option.name;
                    if (!fileName) return false;

                    var folderId = option.folder || option.folderId || this.getCurrentFolder();
                    var fileInfo = this.searchFile({
                        name: fileName,
                        folder: folderId
                    });

                    if (!fileInfo) return false;
                    fileId = fileInfo.id;
                }

                // load the file
                var ns_file = this.loadModule('N/file');
                var fileObj = ns_file.load({
                    id: fileId
                });

                returnValue = fileObj.getContents();
            } catch (e) {
                log.error(logTitle, JSON.stringify(e));
            }

            return returnValue;
        }
    });

    return CTC_UTIL;
});
