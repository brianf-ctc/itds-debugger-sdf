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
 * Module Name: CTC VC2 | Utility Library
 *
 * @author brianf@nscatalyst.com
 * @description Core utility helpers used across VAR Connect 2.x scripts (logging, dates, arrays, HTTP, etc.).
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    // load modules https://requirejs.org/docs/api.html#modulenotes
    var ns_runtime = require('N/runtime'),
        ns_format = require('N/format'),
        ns_record = require('N/record'),
        ns_search = require('N/search'),
        ns_cache = require('N/cache'),
        ns_config = require('N/config'),
        momentLib = require('./Services/lib/moment'),
        ns_xml = null,
        ns_url = null,
        vc2_constant = require('./CTC_VC2_Constants.js');

    // Removed redundant redeclaration; ns_xml and ns_url are declared above.
    var LogTitle = 'VC2_UTILS',
        LogPrefix;

    var vc2_util = {};

    //CHECKERS
    util.extend(vc2_util, {
        /**
         * Checks if a value is considered empty (null, undefined, '', empty array/object).
         * @param {*} stValue
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
         * Returns true if stValue exists in arrValue using loose equality.
         * @param {*} stValue
         * @param {Array<*>} arrValue
         * @returns {boolean}
         */
        inArray: function (stValue, arrValue) {
            if (!stValue || !arrValue) return false;
            for (var i = arrValue.length - 1; i >= 0; i--) if (stValue == arrValue[i]) break;
            return i > -1;
        },
        /**
         * Determines whether a value is strictly undefined.
         * @param {*} value
         * @returns {boolean}
         */
        isUndefined: function (value) {
            // Obtain `undefined` value that's guaranteed to not have been re-assigned
            var undefined = void 0;
            return value === undefined;
        },
        /**
         * Validates required params exist in option.params. Returns true if valid.
         * @param {{params:Object, reqd?:string|string[]}} option
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
                        vc2_util.isEmpty(option.params[field])
                    ) {
                        hasMissing = true;
                    }
                }
            });

            return !hasMissing;
        },
        /**
         * Interprets truthy flags used in NetSuite (true, 'T', 't').
         * @param {*} value
         * @returns {boolean}
         */
        isTrue: function (value) {
            return this.inArray(value, [true, 'T', 't']);
        }
    });

    util.extend(vc2_util, {
        CACHE: {},
        /**
         * Gets a value from the in-memory cache.
         * @param {string} cacheKey
         * @returns {*|null}
         */
        getCache: function (cacheKey) {
            return vc2_util.CACHE.hasOwnProperty(cacheKey) ? vc2_util.CACHE[cacheKey] : null;
        },
        /**
         * Sets a value in the in-memory cache.
         * @param {string} cacheKey
         * @param {*} objVar
         */
        setCache: function (cacheKey, objVar) {
            vc2_util.CACHE[cacheKey] = objVar;
        }
    });

    // CACHE
    ns_cache = require('N/cache');
    util.extend(vc2_util, {
        hashCacheKey: function (cacheKey) {
            if (!cacheKey || cacheKey.length <= 60) return cacheKey;
            return cacheKey.substring(0, 25) + '..' + cacheKey.substring(cacheKey.length - 33);
        },
        NSCACHE_NAME: vc2_constant.CACHE_NAME,
        NSCACHE_KEY: 'VC_20240101',
        NSCACHE_TTL: vc2_constant.CACHE_TTL,
        /**
         * Fetches a value from NetSuite cache (PUBLIC scope).
         * @param {{cacheKey?:string,key?:string,name?:string,cacheTTL?:number,isJSON?:boolean}} option
         * @returns {*|null}
         */
        getNSCache: function (option) {
            var returnValue;
            try {
                var cacheName = vc2_constant.CACHE_NAME,
                    cacheTTL = option.cacheTTL || vc2_util.NSCACHE_TTL;

                var cacheKey = option.cacheKey || option.key || option.name || vc2_util.NSCACHE_KEY;
                if (!cacheKey) throw 'Missing cacheKey!';
                cacheKey = vc2_util.hashCacheKey(cacheKey);

                var cacheObj = ns_cache.getCache({
                    name: cacheName,
                    scope: ns_cache.Scope.PROTECTED
                });

                returnValue = cacheObj.get({ key: cacheKey, ttl: cacheTTL });
                if (option.isJSON && returnValue) returnValue = vc2_util.safeParse(returnValue);

                // vc2_util.log('## NS CACHE (FETCH) ##', '//', [cacheKey]);
            } catch (error) {
                vc2_util.logWarn('getNSCache', error);
                returnValue = null;
            }

            return returnValue;
        },
        /**
         * Stores a value in NetSuite cache (PUBLIC scope).
         * @param {{cacheKey?:string,key?:string,name?:string,cacheTTL?:number,value?:*,cacheValue?:*}} option
         */
        setNSCache: function (option) {
            try {
                var cacheName = vc2_constant.CACHE_NAME,
                    cacheTTL = option.cacheTTL || vc2_util.NSCACHE_TTL;

                var cacheKey = option.cacheKey || option.key || option.name || vc2_util.NSCACHE_KEY;
                if (!cacheKey) throw 'Missing cacheKey!';
                cacheKey = vc2_util.hashCacheKey(cacheKey);

                var cacheValue = option.value || option.cacheValue;
                if (vc2_util.isEmpty(cacheValue)) throw 'Missing cache value!';
                if (!util.isString(cacheValue)) cacheValue = JSON.stringify(cacheValue);
                if (cacheValue.length > 500000)
                    throw 'Cache value exceeds 500KB limit (size: ' + cacheValue.length + ')';

                var cacheObj = ns_cache.getCache({
                    name: cacheName,
                    scope: ns_cache.Scope.PROTECTED
                });
                cacheObj.put({ key: cacheKey, value: cacheValue, ttl: cacheTTL });
                // vc2_util.log('## NS CACHE (STORED) ##', '// ', [cacheKey, cacheTTL]);
            } catch (error) {
                vc2_util.logWarn('setNSCache', error);
            }
        },
        /**
         * Removes a key from NetSuite cache (PUBLIC scope).
         * @param {{cacheKey?:string,key?:string,name?:string,cacheTTL?:number}} option
         */
        removeCache: function (option) {
            try {
                var cacheName = vc2_constant.CACHE_NAME,
                    cacheTTL = option.cacheTTL || vc2_util.NSCACHE_TTL;

                var cacheKey = option.cacheKey || option.key || option.name || vc2_util.NSCACHE_KEY;
                if (!cacheKey) throw 'Missing cacheKey!';
                cacheKey = vc2_util.hashCacheKey(cacheKey);

                var cacheObj = ns_cache.getCache({
                    name: cacheName,
                    scope: ns_cache.Scope.PROTECTED
                });
                cacheObj.remove({ key: cacheKey });

                vc2_util.log('## NS CACHE (REM) ##', '// ', [cacheName, cacheKey, cacheTTL]);
            } catch (error) {
                vc2_util.logWarn('removeNSCache', error);
            }
        },
        /**
         * Saves a cache key into a named list to track multiple cache entries.
         * @param {{listName:string, cacheKey:string}} option
         * @returns {{LIST:string[]}}
         */
        saveCacheList: function (option) {
            var listName = option.listName,
                cacheKey = option.cacheKey;

            var cacheListName = [listName, 'LIST'].join('___');
            var cacheListValue = vc2_util.getNSCache({ name: cacheListName, isJSON: true });

            if (vc2_util.isEmpty(cacheListValue)) cacheListValue = { LIST: [cacheListName] };

            if (!vc2_util.inArray(cacheKey, cacheListValue.LIST))
                cacheListValue.LIST.push(cacheKey);

            vc2_util.log('## NS CACHE (list)', ' // CACHE List: ', [
                listName,
                cacheKey,
                cacheListValue
            ]);

            vc2_util.setNSCache({
                cacheKey: cacheListName,
                value: cacheListValue
            });

            return cacheListValue;
        },
        /**
         * Deletes all cache entries tracked in a named list.
         * @param {{listName:string}} option
         */
        deleteCacheList: function (option) {
            var listName = option.listName;

            var cacheListName = [listName, 'LIST'].join('___');
            var cacheListValue = vc2_util.getNSCache({ name: cacheListName, isJSON: true });

            vc2_util.log('## NS CACHE (reset list)', ' // CACHE List: ', [listName]);

            if (vc2_util.isEmpty(cacheListValue) || vc2_util.isEmpty(cacheListValue.LIST)) return;

            cacheListValue.LIST.forEach(function (cacheKey) {
                vc2_util.removeCache({ name: cacheKey });
                return true;
            });
        }
    });

    util.extend(vc2_util, {
        /**
         * Returns a new array containing unique values from arrVar (preserves order).
         * @param {Array<*>} arrVar
         * @returns {Array<*>}
         */
        uniqueArray: function (arrVar) {
            var arrNew = [];
            for (var i = 0, j = arrVar.length; i < j; i++) {
                if (vc2_util.inArray(arrVar[i], arrNew)) continue;
                arrNew.push(arrVar[i]);
            }

            return arrNew;
        },
        /**
         * Busy-waits for a certain amount of time (ms). Avoid in production flows.
         * @param {number} waitms
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
         * Parses a string to float, stripping non-numeric characters.
         * @param {*} stValue
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
         * Forces integer conversion; returns 0 on NaN/Infinity.
         * @param {*} stValue
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
         * Forces float conversion via parseFloat(); returns 0 on NaN/Infinity.
         * @param {*} stValue
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
         * Safely extracts textContent from various XML node representations.
         * @param {*} node
         * @returns {string|null}
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
                vc2_util.logWarn('getNodeTextContent', err);
            }
            return textContent;
        },
        /**
         * Returns first node's textContent if array-like.
         * @param {*} node
         * @returns {string|undefined}
         */
        getNodeContent: function (node) {
            var returnValue;
            if (node && node.length) returnValue = (node[0] && node[0].textContent) || undefined;

            return returnValue;
        },
        /**
         * Loads a SuiteScript module synchronously via require.
         * @param {string} mod
         * @returns {*}
         */
        loadModule: function (mod) {
            var returnValue = require(mod);
            return returnValue;
        },
        /**
         * Loads a SuiteScript module asynchronously via AMD-style require.
         * @param {string} mod
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
         * Simplifies lookupFields response into a flat object of primitive values.
         * @param {Object} option - see N/search.lookupFields
         * @returns {Object|null}
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
         * Busy-waits for a random time up to max ms.
         * @param {number} max
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
         * Returns a short random string based on timestamp.
         * @param {number} [len=5]
         * @returns {string}
         */
        randomStr: function (len) {
            len = len || 5;
            var str = new Date().getTime().toString();
            return str.substring(str.length - len, str.length);
        },
        /**
         * Rounds a number to 2 decimal places.
         * @param {number|string} value
         * @returns {number}
         */
        roundOff: function (value) {
            var flValue = util.isNumber(value) ? value : this.forceFloat(value || '0');
            if (!flValue || isNaN(flValue)) return 0;

            return Math.round(flValue * 100) / 100;
        },
        /**
         * Retrieves all results from a paged search.
         * @param {N.search.Search} searchObject
         * @returns {Array}
         */
        searchGetAllResult: function (searchObject) {
            var arrResults = [],
                pagedResults = searchObject.runPaged();

            pagedResults.pageRanges.forEach(function (pageRange) {
                arrResults = arrResults.concat(pagedResults.fetch({ index: pageRange.index }).data);
            });

            return arrResults;
        },
        /**
         * Executes tasks in order until one returns truthy without throwing.
         * @param {Array<Function>} arrTasks
         * @returns {boolean}
         */
        tryThese: function (arrTasks) {
            if (!arrTasks) return false;

            for (var i = 0; i < arrTasks.length; i++) {
                var task = arrTasks[i],
                    returnVal = false,
                    isSuccess = false;
                try {
                    returnVal = task.call();
                    if (returnVal || isSuccess) break;
                } catch (e) {
                    vc2_util.logError(logTitle, e);
                }
                if (isSuccess) break;
            }
            return true;
        }
    });

    // DATE FUNCTIONS ///
    util.extend(vc2_util, {
        /**
         * Gets the account date format from cache or preferences.
         * @returns {string}
         */
        getDateFormat: function () {
            var logTitle = [LogTitle, 'getDateFormat'].join('::');
            var dateFormat = vc2_util.CACHE.DATE_FORMAT;

            if (!dateFormat) {
                vc2_util.tryThese([
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

            vc2_util.CACHE.DATE_FORMAT = dateFormat;

            return dateFormat;
        },
        /**
         * Parses a date string using provided/derived format and returns Date.
         * @param {string} dateStr
         * @param {string} [parseformat]
         * @returns {Date|string} Date or 'NA'
         */
        parseToNSDate: function (dateStr, parseformat) {
            var logTitle = [LogTitle, 'parseToNSDate'].join('::');
            if (!dateStr || dateStr == 'NA') return 'NA';

            vc2_constant.GLOBAL.DATE_FORMAT = vc2_util.getDateFormat();

            var dateValue = momentLib(
                dateStr,
                parseformat || vc2_constant.GLOBAL.DATE_FORMAT
            ).toDate();

            var returnDate = dateValue;

            return returnDate;
        },
        /**
         * Parses a date string and returns a string formatted to account format.
         * @param {string} dateStr
         * @param {string} [parseformat]
         * @returns {string}
         */
        parseToVCDate: function (dateStr, parseformat) {
            if (!dateStr || dateStr == 'NA') return 'NA';

            // try to update the date fornat
            vc2_constant.GLOBAL.DATE_FORMAT = vc2_util.getDateFormat();

            // if vc2_constant.GLOBAL.DATE_FORMAT == 'DD-Mon-YYYY', change it to 'DD-MMM-YYYY'
            var format = vc2_constant.GLOBAL.DATE_FORMAT;
            if (format == 'DD-Mon-YYYY') {
                format = 'DD-MMM-YYYY';
            }

            return momentLib(dateStr, parseformat).format(format);
        },
        /**
         * Formats a date to a NetSuite DATE string using account format.
         * @param {{date?:string|Date,value?:string|Date,dateObj?:Date,parseFormat?:string}|string|Date} option
         * @param {string} [parseformat]
         * @returns {string}
         */
        formatToNSDate: function (option, parseformat) {
            var logTitle = [LogTitle, 'formatToNSDate'].join('::');

            vc2_constant.GLOBAL.DATE_FORMAT = vc2_util.getDateFormat();

            var dateStr = util.isObject(option)
                ? option.date || option.value || option.dateObj
                : option;

            var dateObj = momentLib(
                dateStr,
                option.parseFormat || parseformat || vc2_constant.GLOBAL.DATE_FORMAT
            ).toDate();

            var returnDate = ns_format.format({
                value: dateObj,
                type: ns_format.Type.DATE
            });

            vc2_util.log(logTitle, 'FORMAT DATE', {
                dateStr: dateStr,
                dateObj: dateObj,
                returnDate: returnDate
            });

            return returnDate;
        },
        /**
         * Parses a date string to a Date using moment and account format.
         * @param {string} dateStr
         * @param {string} [format]
         * @returns {Date|null}
         */
        momentParse: function (dateStr, format) {
            if (!format) format = vc2_constant.GLOBAL.DATE_FORMAT || this.getDateFormat();
            var returnVal;
            try {
                if (!dateStr || dateStr == 'NA') return null;
                returnVal = momentLib(dateStr, format).toDate();
            } catch (e) {
                vc2_util.log('momentParse', '#error : ', e);
                // } finally {
                //     vc2_util.log('momentParse', '// ', [dateStr, format, returnVal]);
            }
            return returnVal;
        },
        /**
         * Attempts to parse a date from a string using multiple heuristics, returns formatted string.
         * @param {{dateString?:string}|string} option
         * @returns {string}
         */
        parseDate: function (option) {
            var logTitle = [LogTitle, 'parseDate'].join('::');

            var dateString = option.dateString || option,
                dateFormat = vc2_util.CACHE.DATE_FORMAT,
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
                vc2_util.CACHE.DATE_FORMAT = dateFormat;
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
                    vc2_util.logError(logTitle, e);
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
    util.extend(vc2_util, {
        /**
         * Generates a public serial viewer link (Suitelet) with provided params.
         * @param {Object} option - URL params
         * @returns {string}
         */
        generateSerialLink: function (option) {
            ns_url = ns_url || vc2_util.loadModule('N/url') || vc2_util.loadModuleNS('N/url');

            var protocol = 'https://';
            var domain = ns_url.resolveDomain({
                hostType: ns_url.HostType.APPLICATION
            });
            var linkUrl = ns_url.resolveScript({
                scriptId: vc2_constant.SCRIPT.VIEW_SERIALS_SL,
                deploymentId: vc2_constant.DEPLOYMENT.VIEW_SERIALS_SL,
                params: option
            });

            return protocol + domain + linkUrl;
        },
        /**
         * Converts an object to a query string.
         * @param {Object} json
         * @returns {string|undefined}
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
         * Sends an HTTPS request (N/https.request) with retry and logging support.
         * @param {Object} option
         * @param {'get'|'post'} [option.method]
         * @param {Object} option.query - N/https.request options
         * @param {boolean} [option.noLogs]
         * @param {boolean} [option.doRetry]
         * @param {number} [option.retryCount]
         * @param {'JSON'|'XML'} [option.responseType]
         * @param {number} [option.maxRetry]
         * @param {string|number} [option.internalId]
         * @param {boolean} [option.isXML]
         * @param {boolean} [option.isJSON]
         * @param {number} [option.waitMs]
         * @returns {{REQUEST:Object, RESPONSE:Object, PARSED_RESPONSE?:Object, isError?:boolean, errorMsg?:string, error?:*, details?:*}}
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
            if (!queryOption || vc2_util.isEmpty(queryOption)) throw 'Missing query option';

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
                    method: vc2_util.inArray(option.method, _DEFAULT.validMethods)
                        ? option.method
                        : 'get'
                };
            if (option.isXML) param.isJSON = false;
            queryOption.method = param.method.toUpperCase();

            // log.audit(logTitle, '>> param: ' + JSON.stringify(param));
            var LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;
            var startTime = new Date();
            try {
                if (!param.noLogs) {
                    vc2_util.vcLog({
                        title: [param.logHeader, ' Request ', '(' + param.method + ')'].join(''),
                        content: queryOption,
                        transaction: param.logTranId,
                        status: LOG_STATUS.INFO
                    });
                }

                vc2_util.log(
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

                vc2_util.log(logTitle, '>> RESPONSE ', {
                    duration: this.roundOff((new Date() - startTime) / 1000),
                    code: response.code || '-no response-',
                    body: response.body || '-empty response-'
                });

                if (!response || !response.body) {
                    throw 'Empty or Missing Response !';
                }
                responseBody = response.body;
                if (param.isJSON) {
                    parsedResponse = vc2_util.safeParse(response);
                    returnValue.PARSED_RESPONSE = parsedResponse;
                }

                if (!response.code || !vc2_util.inArray(response.code, VALID_RESP_CODE)) {
                    throw parsedResponse
                        ? JSON.stringify(parsedResponse)
                        : 'Received invalid response code - ' + response.code;
                }

                ////////////////////////////
            } catch (error) {
                var errorMsg = vc2_util.extractError(error);
                returnValue.isError = true;
                returnValue.errorMsg = errorMsg;
                returnValue.error = error;
                returnValue.details = parsedResponse || response;

                vc2_util.logError(logTitle, errorMsg);

                if (param.doRetry)
                    vc2_util.log(
                        logTitle,
                        '## RETRY ##  -- ' + param.retryCount + '/' + param.maxRetry
                    );

                if (param.doRetry && param.maxRetry > param.retryCount) {
                    log.audit(logTitle, '... retrying in ' + param.waitMs);
                    option.retryCount = param.retryCount + 1;
                    vc2_util.waitMs(param.waitMs);
                    returnValue = vc2_util.sendRequest(option);
                }
            } finally {
                // vc2_util.log(logTitle, '>> RESPONSE time: ', {
                //     duration: this.roundOff((new Date() - startTime) / 1000)
                // });

                if (!param.noLogs) {
                    vc2_util.vcLog({
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
         *
         * @param {*} option
         *      option.method - 'POST/GET'
         *      option.header - label/title
         *      option.query - actual query options
         *      option.recordId/internalId/transactionId
         *      option.doRetry - true/false
         *      option.maxRetry - int
         *      option.waitMs - ms
         *      option.responseType - JSON/XML
         *      option.isXML - true/false
         *      option.isJSON - true/false
         *      option.noLogs -true/false
         * @returns
         *      REQUEST
         *      RESPONSE
         *      PARSED_RESPONSE
         *      returnValue.isError = true;
         *      returnValue.errorMsg = errorMsg;
         *      returnValue.error = error;
         *      returnValue.details = parsedResponse || response;
         */
        /**
         * Sends an HTTPS Restlet request (N/https.requestRestlet) with retry and logging support.
         * @param {Object} option - same as sendRequest but using requestRestlet under the hood
         * @returns {{REQUEST:Object, RESPONSE:Object, PARSED_RESPONSE?:Object, isError?:boolean, errorMsg?:string, error?:*, details?:*}}
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
            if (!queryOption || vc2_util.isEmpty(queryOption)) throw 'Missing query option';

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
                    method: vc2_util.inArray(option.method, _DEFAULT.validMethods)
                        ? option.method
                        : 'get'
                };
            if (option.isXML) param.isJSON = false;
            queryOption.method = param.method.toUpperCase();

            // log.audit(logTitle, '>> param: ' + JSON.stringify(param));
            var LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;
            var startTime = new Date();
            try {
                if (!param.noLogs) {
                    vc2_util.vcLog({
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
                    parsedResponse = vc2_util.safeParse(response);
                    returnValue.PARSED_RESPONSE = parsedResponse;
                }

                if (!response.code || !vc2_util.inArray(response.code, VALID_RESP_CODE)) {
                    throw parsedResponse
                        ? JSON.stringify(parsedResponse)
                        : 'Received invalid response code - ' + response.code;
                }

                ////////////////////////////
            } catch (error) {
                var errorMsg = vc2_util.extractError(error);
                returnValue.isError = true;
                returnValue.errorMsg = errorMsg;
                returnValue.error = error;
                returnValue.details = parsedResponse || response;

                vc2_util.logError(logTitle, errorMsg);

                if (param.doRetry)
                    vc2_util.log(
                        logTitle,
                        '## RETRY ##  -- ' + param.retryCount + '/' + param.maxRetry
                    );

                if (param.doRetry && param.maxRetry > param.retryCount) {
                    log.audit(logTitle, '... retrying in ' + param.waitMs);
                    option.retryCount = param.retryCount + 1;
                    vc2_util.waitMs(param.waitMs);
                    returnValue = vc2_util.sendRequest(option);
                }
            } finally {
                vc2_util.log(logTitle, '>> RESPONSE time: ', {
                    duration: this.roundOff((new Date() - startTime) / 1000)
                });

                if (!param.noLogs) {
                    vc2_util.vcLog({
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
         * Calls internal Services Restlet with standardized payload and logging.
         * @param {{query?:Object,moduleName?:string,action?:string}} option
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
                scriptId: vc2_constant.SCRIPT.SERVICES_RL,
                deploymentId: vc2_constant.DEPLOYMENT.SERVICES_RL,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serviceQuery)
            };

            return vc2_util.sendRequestRestlet(requestOption);
        },
        /**
         * Parses HTTP response body safely to JSON.
         * @param {{body?:string}|string} response
         * @returns {Object|null}
         */
        safeParse: function (response) {
            var logTitle = [LogTitle, 'safeParse'].join('::'),
                returnValue;
            try {
                returnValue = JSON.parse(response.body || response);
            } catch (error) {
                log.audit(logTitle, '## ' + vc2_util.extractError(error));
                returnValue = null;
            }

            return returnValue;
        },
        /**
         * Delegates response handling based on responseType.
         * @param {Object} request
         * @param {'JSON'|'XML'} responseType
         * @returns {*}
         */
        handleResponse: function (request, responseType) {
            return responseType == 'JSON'
                ? this.handleJSONResponse(request)
                : this.handleXMLResponse(request);
        },
        /**
         * Normalizes JSON response errors and throws a structured error.
         * @param {Object} requestObj
         * @throws {{code?:number,details?:*,message?:string}}
         * @returns {Object}
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

            // // throw requestObj.errorMsg || 'Unable to parse response';

            // // detect the error
            // if (!parsedResp) throw 'Unable to parse response';

            // // check for faultstring
            // if (parsedResp.fault && parsedResp.fault.faultstring)
            //     throw parsedResp.fault.faultstring;

            // // check response.errors
            // if (
            //     parsedResp.errors &&
            //     util.isArray(parsedResp.errors) &&
            //     !vc2_util.isEmpty(parsedResp.errors)
            // ) {
            //     var respErrors = parsedResp.errors
            //         .map(function (err) {
            //             return [err.id, err.message].join(': ');
            //         })
            //         .join(', ');
            //     throw respErrors;
            // }

            // // chek for error_description
            // if (parsedResp.error && parsedResp.error_description)
            //     throw parsedResp.error_description;

            // // ARROW: ResponseHeader

            // if (requestObj.isError || requestObj.RESPONSE.code != '200') {
            //     throw 'Unexpected Error - ' + JSON.stringify(requestObj.PARSED_RESPONSE);
            // }

            return returnValue;
        },
        /**
         * Parses and validates XML responses from vendors; throws on error.
         * @param {Object} request
         * @returns {Object}
         */
        handleXMLResponse: function (request) {
            var logTitle = [LogTitle, 'handleXMLResponse'].join(':'),
                returnValue = request;

            if (request.isError && request.errorMsg) throw request.errorMsg;

            if (!request.RESPONSE || !request.RESPONSE.body)
                throw 'Invalid or missing XML response';

            ns_xml = ns_xml || vc2_util.loadModule('N/xml') || vc2_util.loadModuleNS('N/xml');

            var xmlResponse = request.RESPONSE.body,
                xmlDoc = ns_xml.Parser.fromString({ text: xmlResponse });
            if (!xmlDoc) throw 'Unable to parse XML response';

            // Failure-Message ( D&H )
            var respStatus = vc2_util.getNodeContent(
                ns_xml.XPath.select({ node: xmlDoc, xpath: '//STATUS' })
            );

            if (respStatus && vc2_util.inArray(respStatus.toUpperCase(), ['FAILURE'])) {
                var respStatusMessage = vc2_util.getNodeContent(
                    ns_xml.XPath.select({ node: xmlDoc, xpath: '//MESSAGE' })
                );

                throw respStatusMessage || 'Unexpected failure';
            }

            // ERROR DETAIL - Synnex
            var respErrorDetail = vc2_util.getNodeContent(
                ns_xml.XPath.select({ node: xmlDoc, xpath: '//ErrorDetail' })
            );
            if (respErrorDetail) throw respErrorDetail;

            //OrderInfo/ErrorMsg - TechData
            var respErrorInfo =
                vc2_util.getNodeContent(
                    ns_xml.XPath.select({ node: xmlDoc, xpath: '//OrderInfo/ErrorMsg' })
                ) ||
                vc2_util.getNodeContent(ns_xml.XPath.select({ node: xmlDoc, xpath: '//ErrorMsg' }));
            if (respErrorInfo) throw respErrorInfo;

            return returnValue;
        }
    });

    // LOGS
    util.extend(vc2_util, {
        /**
         * Placeholder for centralized error handling.
         * @param {*} error
         * @param {string} logTitle
         */
        handleError: function (error, logTitle) {},
        /**
         * Returns remaining governance usage as a formatted string.
         * @returns {string}
         */
        getUsage: function () {
            var REMUSAGE = ns_runtime.getCurrentScript().getRemainingUsage();
            return '[usage:' + REMUSAGE + '] ';
        },
        /**
         * Extracts a human-readable error message from various error shapes.
         * @param {*} option
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
         * Writes a VC Log record or stages it into a batch for later submission.
         * @param {Object} option
         * @returns {boolean}
         */
        vcLog: function (option) {
            var logTitle = [LogTitle, 'vcLog'].join('::');

            var VC_LOG = vc2_constant.RECORD.VC_LOG,
                LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;

            try {
                var logOption = {},
                    batchTransaction = option.batch,
                    isBatched = batchTransaction != null;

                logOption.DATE = new Date();
                logOption.APPLICATION = option.appName || vc2_constant.LOG_APPLICATION;
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
                    var errorMsg = vc2_util.extractError(option.error);
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
                    var VC_LOG_BATCH = vc2_constant.RECORD.VC_LOG_BATCH;
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
                log.error(logTitle, LogPrefix + '## ERROR ## ' + vc2_util.extractError(error));
            }
            return true;
        },
        /**
         * Convenience wrapper for writing error VC Logs with standard formatting.
         * @param {Object} option
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
                    option.errorMsg || option.error || vc2_util.extractError(option.error)
                ].join(' - ');
            }
            logOption.status = option.status || vc2_constant.LIST.VC_LOG_STATUS.ERROR; // common error

            return this.vcLog(logOption);
        },
        _batchedVCLogs: {},
        /**
         * Persists a previously staged VC Log batch if it contains any lines.
         * @param {number|string} batchTransaction
         */
        submitVCLogBatch: function (batchTransaction) {
            var logTitle = [LogTitle, 'submitVCLogBatch'].join('::');
            var recBatch = this._batchedVCLogs[batchTransaction];
            if (recBatch) {
                var VC_LOG = vc2_constant.RECORD.VC_LOG,
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
         * Unified logging wrapper supporting different log levels and payloads.
         * @param {string} logTitle
         * @param {string|{msg?:string,text?:string,content?:string,prefix?:string,pre?:string,prfx?:string,type?:'audit'|'debug'|'error'|'emergency'|'critical'|'notice'|'warning'|'trace'}} msg
         * @param {*} [objvar]
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
                    vc2_util.getUsage() +
                        (logPrefx ? logPrefx + ' ' : '') +
                        logMsg +
                        (!vc2_util.isEmpty(objvar) ? JSON.stringify(objvar) : '')
                );
            } catch (error) {
                log.error('LOG ERROR', vc2_util.extractError(error));
            }

            return true;
        },
        /**
         * Writes a WARN-level log entry.
         * @param {string} logTitle
         * @param {*} warnMsg
         */
        logWarn: function (logTitle, warnMsg) {
            vc2_util.log(logTitle, { type: 'audit', msg: '[WARNING] : ' }, warnMsg);
            return;
        },
        /**
         * Writes an EXCEPTION-level log entry.
         * @param {string} logTitle
         * @param {*} exceptionMsg
         */
        logException: function (logTitle, exceptionMsg) {
            vc2_util.log(logTitle, { type: 'audit', msg: '[EXCEPTION] : ' }, exceptionMsg);
            return;
        },
        /**
         * Writes a TRACE-level log entry.
         * @param {string} logTitle
         * @param {string} traceMsg
         * @param {*} traceVar
         */
        logTrace: function (logTitle, traceMsg, traceVar) {
            vc2_util.log(logTitle, { type: 'trace', msg: '[TRACE] : ' + traceMsg }, traceVar);
            return;
        },
        /**
         * Writes an ERROR-level log entry.
         * @param {string} logTitle
         * @param {*} errorMsg
         */
        logError: function (logTitle, errorMsg) {
            vc2_util.log(logTitle, { type: 'error', msg: '[ERROR] :  ' }, errorMsg);
            return;
        },
        /**
         * Writes a DEBUG-level log entry.
         * @param {string} logTitle
         * @param {string|Object} msg
         * @param {*} [msgVar]
         */
        logDebug: function (logTitle, msg, msgVar) {
            var msgObj = util.isString(msg) ? { msg: msg } : msg;
            msgObj.type = 'debug';

            vc2_util.log(logTitle, msgObj, msgVar);
            return;
        },
        /**
         * Logs each property/value pair of an object with optional prefix.
         * @param {string} logTitle
         * @param {Object} dumpObj
         * @param {string} [prefix]
         */
        dumpLog: function (logTitle, dumpObj, prefix) {
            for (var fld in dumpObj) {
                vc2_util.log(logTitle, [prefix || '', ':', fld].join('') + ' ', dumpObj[fld]);
            }
            return;
        },
        /**
         * Formats a standardized success log message for record operations.
         * @param {{recordType?:string,recordId:string|number,recordAction?:string,lines?:Array<Object>}} option
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
    util.extend(vc2_util, {
        /**
         * Performs a search using runPaged, with optional filters/columns, and returns results up to maxResults.
         * @param {{id?:string,searchId?:string,recordType?:string,type?:string,searchObj?:N.search.Search,filters?:Array,filterExpression?:Array,columns?:Array,maxResults?:number}} option
         * @returns {Array<N.search.Result>}
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
         * Returns true if OneWorld (Subsidiaries) feature is enabled.
         * @returns {boolean}
         */
        isOneWorld: function () {
            return ns_runtime.isFeatureInEffect({ feature: 'Subsidiaries' });
        }
    });

    // object
    util.extend(vc2_util, {
        /**
         * Shallow-extends source with contrib preserving original source values.
         * @param {Object} source
         * @param {Object} contrib
         * @returns {Object}
         */
        extend: function (source, contrib) {
            // do this to preserve the source values
            return util.extend(util.extend({}, source), contrib);
        },
        /**
         * Returns a copy of object excluding null-valued properties.
         * @param {Object} option
         * @returns {Object}
         */
        removeNullValues: function (option) {
            var newObj = {};
            if (!option || vc2_util.isEmpty(option) || !util.isObject(option)) return newObj;

            for (var prop in option) {
                if (option[prop] === null) continue;
                newObj[prop] = option[prop];
            }

            return newObj;
        },
        /**
         * Copies values from contrib into source, with options to overwrite and onlyNullValues.
         * @param {Object} source
         * @param {Object} contrib
         * @param {{onlyNullValues?:boolean, overwriteSource?:boolean}} [option]
         * @returns {Object|boolean}
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
         * Deep clones a JSON-serializable object.
         * @param {*} obj
         * @returns {*}
         */
        clone: function (obj) {
            return JSON.parse(JSON.stringify(obj));
        },
        /**
         * Finds matching objects in a list based on a filter map or predicate functions.
         * @param {{dataSource?:Array<Object>,dataSet?:Array<Object>,list?:Array<Object>,filter:Object,findAll?:boolean}} option
         * @returns {Object|Array<Object>|false}
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

            if (vc2_util.isEmpty(dataSource) || !util.isArray(dataSource)) return false;

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
         * Extracts a subset of fields from a source object.
         * @param {{source?:Object,sourceObj?:Object,params?:Array<string>,fields?:Array<string>}} option
         * @returns {Object|false}
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
         * Returns the enumerable own property names from an object.
         * @param {Object} option
         * @returns {Array<string>|false}
         */
        arrayKeys: function (option) {
            var logTitle = [LogTitle, 'arrayKeys'].join('::'),
                returnValue = [];

            if (vc2_util.isEmpty(option)) return false;

            for (var fld in option) {
                if (!vc2_util.inArray(fld, returnValue)) returnValue.push(fld);
            }

            return returnValue;
        },
        /**
         * Returns the enumerable own property values from an object.
         * @param {Object} option
         * @returns {Array<*>|false}
         */
        arrayValues: function (option) {
            var logTitle = [LogTitle, 'arrayValues'].join('::'),
                returnValue = [];
            if (vc2_util.isEmpty(option)) return false;

            for (var fld in option) {
                if (!vc2_util.inArray(option[fld], returnValue)) returnValue.push(option[fld]);
            }

            return returnValue;
        },
        /**
         * Finds keys in source whose values match any of the provided value(s).
         * @param {{source?:Object,sourceObj?:Object,value?:*|Array<*>,values?:*|Array<*>}} option
         * @returns {Array<string>|false}
         */
        getKeysFromValues: function (option) {
            var logTitle = [LogTitle, 'getKeyValues'].join('::'),
                returnValue;

            var sourceObj = option.source || option.sourceObj,
                values = option.value || option.values;

            if (
                vc2_util.isEmpty(sourceObj) ||
                vc2_util.isEmpty(values) ||
                !util.isObject(sourceObj) ||
                (!util.isArray(values) && !util.isString(values))
            )
                return false;

            if (!util.isArray(values)) values = [values];

            returnValue = [];
            for (var fld in sourceObj) {
                if (
                    vc2_util.inArray(sourceObj[fld], values) &&
                    !vc2_util.inArray(fld, returnValue)
                ) {
                    returnValue.push(fld);
                }
            }

            return returnValue;
        },
        /**
         * Finds values in source for the provided keys.
         * @param {{source?:Object,sourceObj?:Object,params?:Array<string>|string,keys?:Array<string>|string}} option
         * @returns {Array<*>|false}
         */
        getValuesFromKeys: function (option) {
            var logTitle = [LogTitle, 'getValuesFromKeys'].join('::'),
                returnValue;

            var sourceObj = option.source || option.sourceObj,
                params = option.params || option.keys;

            if (
                vc2_util.isEmpty(sourceObj) ||
                vc2_util.isEmpty(params) ||
                !util.isObject(sourceObj) ||
                (!util.isArray(params) && !util.isString(params))
            )
                return false;

            if (!util.isArray(params)) params = [params];

            returnValue = [];
            for (var fld in sourceObj) {
                if (
                    vc2_util.inArray(fld, params) &&
                    !vc2_util.inArray(sourceObj[fld], returnValue)
                ) {
                    returnValue.push(sourceObj[fld]);
                }
            }

            return returnValue;
        },
        /**
         * Splits an array into chunks of given size.
         * @param {Array<*>} array
         * @param {number} chunkSize
         * @returns {Array<Array<*>>}
         */
        sliceArrayIntoChunks: function (array, chunkSize) {
            var chunks = [];
            for (var i = 0; i < array.length; i += chunkSize) {
                var chunk = array.slice(i, i + chunkSize);
                chunks.push(chunk);
            }
            return chunks;
        }
    });

    // files
    util.extend(vc2_util, {
        /**
         * Determines the folder path/id where the current script file is located.
         * @param {{scriptId?:string,currentScript?:any,runtime?:N.runtime}} [option]
         * @returns {{path:string,id:number}|null}
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
         * Searches by filename (and optional folder) and returns basic file info.
         * @param {{filename?:string,name?:string,folder?:number,folderId?:number,noCache?:boolean,doReturnArray?:boolean}} option
         * @returns {Object|Array<Object>|false}
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
         * Loads a file (by id or name/folder) and returns its contents as string.
         * @param {{fileId?:number,filename?:string,name?:string,folder?:number,folderId?:number}} option
         * @returns {string|null|false}
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

    return vc2_util;
});
