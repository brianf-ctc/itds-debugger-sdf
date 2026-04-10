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
 * Script Name: VC Services | Config Library
 *
 * @author brianf@nscatalyst.com
 * @description Configuration helper for Services, loading vendor and VC configuration values.
 *    Provides a unified EndPoint facade for loading Main, Order Vendor, Bill Vendor, and
 *    Send PO Vendor configurations, as well as license validation and config data transmission.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-27   brianf        Fixed searchTransaction param from name to tranid for PO lookup
 * 2026-03-17   brianf        Fixed error handling: added 8 ERROR_MSG constants for all thrown errors; updated Helper.isInternalError() to check ERROR_MSG
 *                            shape (code/message/level); replaced all hardcoded string throws with structured ERROR_MSG references
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var LogTitle = 'SVC:ConfigLib';

    var ns_search = require('N/search'),
        ns_record = require('N/record'),
        ns_runtime = require('N/runtime'),
        ns_url = require('N/url'),
        ns_https = require('N/https');

    var vclib_error = require('./lib/ctc_lib_error.js'),
        vclib_util = require('./lib/ctc_lib_utils.js');

    var vc2_util = require('../CTC_VC2_Lib_Utils'),
        vc2_constant = require('../CTC_VC2_Constants');

    var vcs_recordLib = require('./ctc_svclib_records.js');

    var ENABLE_LOG = false;
    var ERROR_MSG_OLD = {
        MISSING_VENDOR_CONFIG_OR_INVALID_PO: 'Please provide a vendor configuration or PO record'
    };

    var ERROR_MSG = {
        MISSING_VENDOR_CONFIG_OR_INVALID_PO: {
            code: 'MISSING_VENDOR_CONFIG_OR_INVALID_PO',
            message: 'Please provide a vendor configuration or PO record',
            level: vclib_error.ErrorLevel.WARNING
        },
        LICENSE_FETCH_ERROR: {
            code: 'LICENSE_FETCH_ERROR',
            message: 'Unable to retrieve license information',
            level: vclib_error.ErrorLevel.ERROR
        },
        LICENSE_INVALID_RESPONSE: {
            code: 'LICENSE_INVALID_RESPONSE',
            message: 'Received invalid response code from license server',
            level: vclib_error.ErrorLevel.ERROR
        },
        LICENSE_PARSE_ERROR: {
            code: 'LICENSE_PARSE_ERROR',
            message: 'Unable to parse license response',
            level: vclib_error.ErrorLevel.ERROR
        },
        LICENSE_NOT_ACTIVE: {
            code: 'LICENSE_NOT_ACTIVE',
            message: 'License is not active',
            level: vclib_error.ErrorLevel.ERROR
        },
        RECORD_SEARCH_EMPTY: {
            code: 'RECORD_SEARCH_EMPTY',
            message: 'No search results found',
            level: vclib_error.ErrorLevel.WARNING
        },
        PAYLOAD_BUILD_FAILED: {
            code: 'PAYLOAD_BUILD_FAILED',
            message: 'Failed to build configuration payload',
            level: vclib_error.ErrorLevel.ERROR
        },
        CONFIG_SEND_ERROR: {
            code: 'CONFIG_SEND_ERROR',
            message: 'Failed to transmit configuration to remote server',
            level: vclib_error.ErrorLevel.ERROR
        },
        CONFIG_SEND_RESPONSE_ERROR: {
            code: 'CONFIG_SEND_RESPONSE_ERROR',
            message: 'Received invalid response code from config server',
            level: vclib_error.ErrorLevel.ERROR
        }
    };

    var MAIN_CFG = vc2_constant.RECORD.MAIN_CONFIG,
        VENDOR_CFG = vc2_constant.RECORD.VENDOR_CONFIG,
        BILL_CFG = vc2_constant.RECORD.BILLCREATE_CONFIG,
        SENDPOVND_CFG = vc2_constant.RECORD.SENDPOVENDOR_CONFIG;

    var VC_LICENSE = vc2_constant.LICENSE;
    var Helper = {
        isInternalError: function (error) {
            var errorMessage = error,
                returnValue = false;
            if (error && error.message) {
                errorMessage = error.message;
            }
            for (var errorName in ERROR_MSG) {
                if (
                    ERROR_MSG[errorName].code === errorMessage ||
                    ERROR_MSG[errorName].message === errorMessage
                ) {
                    returnValue = true;
                    break;
                }
            }
            if (!returnValue) {
                for (var oldKey in ERROR_MSG_OLD) {
                    if (ERROR_MSG_OLD[oldKey] === errorMessage) {
                        returnValue = true;
                        break;
                    }
                }
            }
            return returnValue;
        }
    };

    //// LICENSE LIBRARY ////
    var LibLicense = {
        /**
         * @function fetchLicense
         * @description Fetches license information from the Catalyst license server via HTTP GET.
         *   Supports configurable retry logic on failure.
         * @param {Object} option - Configuration options
         * @param {boolean} [option.doRetry=false] - Whether to retry on failure
         * @param {number} [option.maxRetry=3] - Maximum number of retry attempts
         * @param {number} [option.retryWaitMS=1000] - Milliseconds to wait between retries
         * @param {number} [option.retryCount=1] - Current retry count (used internally for recursion)
         * @returns {Object} License data object, or `{ hasError: true, errorMsg: string }` on failure
         */
        fetchLicense: function (option) {
            var logTitle = 'VC_LICENSE::fetchLicense',
                logPrefix = '[LICENSE-CHECK] ',
                response,
                returnValue = {};

            var startTime = new Date();

            var doRetry = option.doRetry,
                maxRetry = doRetry ? option.maxRetry || VC_LICENSE.MAX_RETRY : 0,
                retryCount = option.retryCount || 1,
                retryWaitMS = option.retryWaitMS || option.retryWait || 1000;

            try {
                var queryOption = {
                    method: ns_https.Method.GET,
                    url:
                        VC_LICENSE.URL +
                        '?' +
                        ('producttypeid=' + VC_LICENSE.PRODUCT_CODE) +
                        ('&nsaccountid=' + ns_runtime.accountId)
                };
                vclib_util.log(logTitle, logPrefix + 'Send Request query: ', queryOption);
                response = ns_https.request(queryOption);

                vclib_util.log(logTitle, logPrefix + 'Response: ', response);

                if (!response || !response.body) throw ERROR_MSG.LICENSE_FETCH_ERROR.code;
                if (!response.code || response.code !== 200)
                    throw ERROR_MSG.LICENSE_INVALID_RESPONSE.code;
                doRetry = false;

                var parsedResp = vclib_util.safeParse(response.body);
                if (!parsedResp) throw ERROR_MSG.LICENSE_PARSE_ERROR.code;

                returnValue = parsedResp;
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error);

                returnValue.hasError = true;
                returnValue.errorMsg = errorObj.message;

                if (doRetry && maxRetry > retryCount) {
                    vclib_util.log(logTitle, logPrefix + '... retry count : ' + retryCount);
                    option.retryCount = retryCount + 1;
                    vclib_util.waitMs(retryWaitMS); // wait before re-sending
                    returnValue = LibLicense.fetchLicense(option);
                }
            } finally {
                var durationSec = vclib_util.roundOff((new Date() - startTime) / 1000);
                vclib_util.log(logTitle, logPrefix + '# response time: ' + durationSec + 's');
            }

            return returnValue;
        },
        /**
         * @function validate
         * @description Validates the current installation's license against the Catalyst license
         *   server. On the first call (or when the cache is expired/invalid), delegates to
         *   `fetchLicense` to retrieve a fresh result. Subsequent calls use the NS cache until
         *   the TTL expires. Returns a license info object indicating status and any error.
         * @param {Object} [option] - Options (reserved for future use)
         * @returns {Object} License info: `{ status, message, hasError, error }`
         */
        validate: function (option) {
            var logTitle = 'VC_LICENSE::validate',
                logPrefix = '[LICENSE-CHECK] ',
                returnValue = {};

            try {
                // prep the cache
                var licenseInfo = vclib_util.getNSCache({ name: VC_LICENSE.KEY });
                licenseInfo = vclib_util.safeParse(licenseInfo);

                var checkLicenseBad = function (licenseData) {
                    return (
                        // no cache retrieved
                        !licenseData ||
                        // error on license response
                        licenseData.hasError ||
                        // error on license server
                        licenseData.error ||
                        // inactive license
                        licenseData.status !== 'active'
                    );
                };

                // validate the license
                if (checkLicenseBad(licenseInfo)) {
                    // force fetch the license
                    licenseInfo = LibLicense.fetchLicense(option);
                    vclib_util.log(logTitle, logPrefix + '...license data: ', licenseInfo);

                    if (
                        (licenseInfo && licenseInfo.status && licenseInfo.status !== 'active') ||
                        !vclib_util.isEmpty(licenseInfo.error)
                    )
                        throw 'License is not active';

                    licenseInfo.hasError = false;

                    //// CACHE the license info, if its not bad ////
                    if (!checkLicenseBad(licenseInfo)) {
                        vclib_util.setNSCache({
                            name: VC_LICENSE.KEY,
                            value: licenseInfo,
                            cacheTTL: VC_LICENSE.CACHE_TTL
                        });
                    }
                }

                returnValue = licenseInfo;
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error);

                returnValue.hasError = true;
                returnValue.errorMsg = errorObj.message;
            } finally {
                vclib_util.log(
                    logTitle,
                    logPrefix + '... license validation result: ',
                    returnValue
                );

                if (returnValue.errorMsg)
                    vclib_util.logError(logTitle, logPrefix + returnValue.errorMsg);
            }

            return returnValue;
        }
    };

    var ListConfigType = {
        MAIN: 'MAIN_CONFIG',
        VENDOR: 'VENDOR_CONFIG',
        ORDER: 'VENDOR_CONFIG',
        BILL: 'BILLCREATE_CONFIG',
        SENDPO: 'SENDPOVENDOR_CONFIG'
    };

    // CONFIG LIB ////
    var ConfigLib = {
        ConfigType: ListConfigType.MAIN,
        CacheKey: null,
        CacheParams: [],
        /**
         * @function buildSearchOption
         * @description Builds the NS search options object for retrieving config records.
         *   Resets `CacheParams` on each call.
         * @param {Object} option - Options
         * @param {string} [option.configType] - Config type key (MAIN|VENDOR|BILL|SENDPO)
         * @returns {Object} NS search options `{ type, filters, columns }`
         */
        buildSearchOption: function (option) {
            var configType = option.configType || this.ConfigType;

            var configRecord = vc2_constant.RECORD[configType],
                configMap = vc2_constant.MAPPING[configType];

            // reset the cache params
            this.CacheParams = [];

            return {
                type: configRecord.ID,
                filters: [['isinactive', 'is', 'F']],
                columns: (function () {
                    var flds = ['name'];
                    for (var fld in configMap) flds.push(configMap[fld]);
                    return flds;
                })()
            };
        },
        /**
         * @function load
         * @description Loads a single config record matching the given criteria.
         *   Resolves the associated PO record if `poId`/`poNum` is provided, builds
         *   the search option, checks the NS cache, and runs the search if not cached.
         * @param {Object} [option] - Options
         * @param {string|number} [option.poId] - Internal ID of the PO to resolve
         * @param {string} [option.poNum] - Transaction number of the PO
         * @param {boolean} [option.nocache] - Skip cache lookup
         * @returns {Object|false} Config data object, or `false` if not found
         */
        load: function (option) {
            var logTitle = [LogTitle, 'ConfigLib.load'].join('::'),
                returnValue;

            option = option || {};

            vclib_util.LogPrefix = '[' + this.ConfigNameValue + '] ';

            if (ENABLE_LOG) vclib_util.log(logTitle, '// option [CONFIG]: ', option);
            try {
                var configMap = vc2_constant.MAPPING[this.ConfigType],
                    configData = {},
                    recordData = {};

                // load the current record
                if (option.poId || option.poNum) {
                    recordData = vcs_recordLib.searchTransaction({
                        tranid: option.poNum,
                        id: option.poId,
                        type: ns_record.Type.PURCHASE_ORDER,
                        columns: [
                            'entity',
                            'internalid',
                            'vendor.internalid',
                            'vendor.entityid',
                            'vendor.custentity_vc_bill_config'
                        ]
                    });

                    option.recordData = recordData;
                }

                /// build the search option
                var searchOption = this.buildSearchOption(option);

                // check for the cache
                var cachedValue = this.getCache(option);

                if (!vclib_util.isEmpty(cachedValue) && !option.nocache) {
                    returnValue = cachedValue;
                    return cachedValue;
                }
                if (ENABLE_LOG) vclib_util.log(logTitle, '**** LOADING CONFIG: START ****');
                if (ENABLE_LOG) vclib_util.log(logTitle, '// searchOption: ', searchOption);
                var searchObj = ns_search.create(searchOption);
                if (!searchObj) return false;

                var numResults = searchObj.runPaged().count;
                if (ENABLE_LOG) vclib_util.log(logTitle, '###  Total Results: ', numResults);

                // run the search values
                searchObj.run().each(function (row) {
                    configData.name = row.getValue({ name: 'name' });
                    for (var field in configMap) {
                        var value = row.getValue({ name: configMap[field] });
                        configData[field] = !vclib_util.isEmpty(value)
                            ? value.value || value
                            : null;
                    }
                    return true;
                });
                // add the country code
                if (
                    !vclib_util.isEmpty(configData) &&
                    !vclib_util.isEmpty(recordData) &&
                    recordData.country
                )
                    configData.country = recordData.country.value || recordData.country;

                // set the default country code to US
                if (!configData.country) configData.country = 'US';

                if (!vclib_util.isEmpty(configData)) this.setCache(configData);

                returnValue = configData;
            } catch (error) {
                // skip logging errors created within this function
                if (!Helper.isInternalError(error)) {
                    vclib_util.logError(logTitle, error);
                }
                throw error;
            } finally {
                if (ENABLE_LOG)
                    vclib_util.log(logTitle, '### CONFIG:', [
                        returnValue,
                        this.CacheParams,
                        this.CacheKey
                    ]);
                vclib_util.LogPrefix = ''; // reset the log prefix
            }
            return returnValue;
        },
        /**
         * @function search
         * @description Searches for all config records matching the given criteria and
         *   returns them as an array. Unlike `load`, returns all matches.
         * @param {Object} [option] - Search options
         * @param {string|number} [option.poId] - Internal ID of the PO to scope the search
         * @param {string} [option.poNum] - Transaction number of the PO
         * @param {boolean} [option.nocache] - Skip cache lookup
         * @returns {Array|false} Array of config data objects, or `false` on failure
         */
        search: function (option) {
            var logTitle = [LogTitle, 'ConfigLib.search'].join('::'),
                returnValue = null;
            option = option || {};

            vclib_util.LogPrefix = '[' + this.ConfigNameValue + '] ';
            if (ENABLE_LOG) vclib_util.log(logTitle, '// option [CONFIG]: ', option);

            try {
                var configMap = vc2_constant.MAPPING[this.ConfigType],
                    configList = [],
                    recordData = option.recordData || {};

                if (vclib_util.isEmpty(recordData) && (option.poId || option.poNum)) {
                    recordData = vcs_recordLib.searchTransaction({
                        name: option.poNum,
                        id: option.poId,
                        type: ns_record.Type.PURCHASE_ORDER,
                        columns: [
                            'entity',
                            'internalid',
                            'vendor.internalid',
                            'vendor.entityid',
                            'vendor.custentity_vc_bill_config'
                        ]
                    });

                    option.recordData = recordData;
                }

                var searchOption = this.buildSearchOption(option);
                var cachedValue = this.getCache(option);

                if (!vclib_util.isEmpty(cachedValue) && !option.nocache) {
                    return cachedValue;
                }

                if (ENABLE_LOG) vclib_util.log(logTitle, '**** SEARCHING CONFIG: START ****');
                var results = vcs_recordLib.searchRecord(searchOption);

                if (!results) throw ERROR_MSG.RECORD_SEARCH_EMPTY.code;
                if (ENABLE_LOG) vclib_util.log(logTitle, '###  Total Results: ', results.length);

                results.forEach(function (row) {
                    var configData = { name: row.name };
                    for (var field in configMap) {
                        var value = row[configMap[field]];
                        configData[field] = !vclib_util.isEmpty(value)
                            ? value.value || value
                            : null;
                    }

                    if (!vclib_util.isEmpty(recordData) && recordData.country)
                        configData.country = recordData.country.value || recordData.country;
                    else configData.country = 'US';

                    configList.push(configData);
                });

                returnValue = configList;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        /**
         * @function buildPayload
         * @description Builds the payload array for transmitting a config record's field values
         *   to the Catalyst license server. Performs a flat lookup on the config record, optionally
         *   updates the record name if it matches its internal ID, then serializes all fields.
         * @param {Object} option - Options
         * @param {string} [option.configType] - Config type key; defaults to `this.ConfigType`
         * @param {string|number} [option.configId] - Internal ID of the config record
         * @param {string|number} [option.id] - Alias for `option.configId`
         * @param {string[]} [option.skippedFields] - Field IDs to exclude from the payload
         * @returns {Array|false} Array of payload data objects, or `false` on failure
         */
        buildPayload: function (option) {
            var logTitle = [LogTitle, 'ConfigLib.buildPayload'].join('::'),
                returnValue;
            option = option || {};

            try {
                // generate the payload
                var configType = option.configType || this.ConfigType;
                var configRecordDef = vc2_constant.RECORD[configType],
                    configId = option.configId || option.id,
                    skippedFields = option.skippedFields || this.SkippedFields,
                    configFields = ['name', 'isinactive', 'internalid'],
                    configNameField = option.nameField || this.ConfigNameField,
                    configNameValue = option.nameValue || this.ConfigNameValue,
                    payloadData = [];

                configRecordDef.FIELD['NAME'] = 'name';
                configRecordDef.FIELD['INACTIVE'] = 'isinactive';
                configRecordDef.FIELD['MODIFIED'] = 'lastmodified';
                configRecordDef.FIELD['MODIFIED_BY'] = 'lastmodifiedby';

                for (var fieldName in configRecordDef.FIELD) {
                    if (vclib_util.inArray(configRecordDef.FIELD[fieldName], skippedFields))
                        continue;
                    configFields.push(configRecordDef.FIELD[fieldName]);
                }
                if (configNameField) configFields.push(configNameField);

                // Do the lookup
                var configData = vclib_util.flatLookup({
                    type: configRecordDef.ID,
                    id: configId,
                    columns: configFields
                });

                // TRY to update CONFIG.name ////////
                if (
                    configData.name == configData.internalid.value &&
                    (configNameValue || (configNameField && configData[configNameField]))
                ) {
                    configData.name =
                        configNameField && configData[configNameField]
                            ? configData[configNameField].text || configData[configNameField]
                            : configNameValue;

                    if (ENABLE_LOG)
                        vclib_util.log(logTitle, ' **** FIX CONFIG NAME ***** ', configData.name);

                    ns_record.submitFields({
                        type: configRecordDef.ID,
                        id: configId,
                        values: { name: configData.name }
                    });
                }
                //////////////////////////////////////////
                // initialize the payloadData
                payloadData.push({
                    settingFieldId: '_config_name',
                    settingFieldName: 'CONFIG_NAME',
                    settingValue: configType
                });

                for (var fldName in configRecordDef.FIELD) {
                    var fieldId = configRecordDef.FIELD[fldName],
                        fieldValue =
                            configData[fieldId] == null
                                ? 'null'
                                : configData[fieldId] === true
                                  ? 'T'
                                  : configData[fieldId] === false
                                    ? 'F'
                                    : configData[fieldId];

                    var data = {
                        settingFieldId: fieldId,
                        settingFieldName: fldName,
                        settingValue: fieldValue.value || fieldValue
                    };
                    if (
                        configData.hasOwnProperty(fieldId) &&
                        fieldValue.text &&
                        fieldValue.text !== data.settingValue
                    ) {
                        data['settingFieldText'] = fieldValue.text;
                    }
                    payloadData.push(data);
                }

                returnValue = payloadData;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        /**
         * @function send
         * @description Builds a payload from a config record and POSTs it to the Catalyst license
         *   server for telemetry and validation tracking.
         * @param {Object} option - Options
         * @param {string} [option.configType] - Config type key; defaults to `this.ConfigType`
         * @param {string|number} option.id - Internal ID of the config record to send
         * @returns {string|false} Response body string from the license server, or `false` on failure
         */
        send: function (option) {
            var logTitle = [LogTitle, 'ConfigLib.send'].join('::'),
                returnValue;
            option = option || {};

            try {
                var configType = option.configType || this.ConfigType;
                var configRecord = vc2_constant.RECORD[configType],
                    configId = option.id;

                var configURL =
                    'https://' +
                    ns_url.resolveDomain({
                        hostType: ns_url.HostType.APPLICATION,
                        accountId: ns_runtime.accountId
                    }) +
                    ns_url.resolveRecord({ recordType: configRecord.ID, recordId: configId });

                if (ENABLE_LOG) vclib_util.log(logTitle, '// configURL: ', configURL);

                var payloadData = this.buildPayload(option);
                if (!payloadData) throw ERROR_MSG.PAYLOAD_BUILD_FAILED.code;
                var queryOption = {
                    method: ns_https.Method.POST,
                    url:
                        'https://nscatalystserver.azurewebsites.net/logconfig.php' +
                        '?' +
                        ('producttypeid=' + VC_LICENSE.PRODUCT_CODE) +
                        ('&nsaccountid=' + ns_runtime.accountId) +
                        ('&settingsid=' + configId) +
                        ('&rectype=' + configRecord.ID) +
                        ('&settingsurl=' + encodeURIComponent(configURL)),
                    body: JSON.stringify(payloadData)
                };

                //// SEND THE REQUEST ////
                if (ENABLE_LOG)
                    vclib_util.log(logTitle, '### Send Request query: ', queryOption.url);
                var response = ns_https.request(queryOption);
                if (ENABLE_LOG) vclib_util.log(logTitle, '### Response: ', response);
                /////////////////////////

                if (!response || !response.body) throw ERROR_MSG.CONFIG_SEND_ERROR.code;
                if (!response.code || response.code !== 200)
                    throw ERROR_MSG.CONFIG_SEND_RESPONSE_ERROR.code;

                returnValue = response.body;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        /// CACHING ///
        /**
         * @function generateCacheKey
         * @description Builds and stores the NS cache key for this config instance,
         *   composed of the config type constant, unique CacheParams, and optionally
         *   a timestamp suffix in debug mode.
         * @returns {string} The generated cache key
         */
        generateCacheKey: function (option) {
            var configType = this.ConfigType;

            if (this.CacheParams && this.CacheParams.length) {
                this.CacheParams = vclib_util.uniqueArray(this.CacheParams);
            }

            var cacheKey = [
                vc2_constant.CACHE_KEY[configType],
                this.CacheParams.join('&'),
                vc2_constant.IS_DEBUG_MODE ? new Date().getTime() : null
            ].join('__');

            this.CacheKey = cacheKey;

            return cacheKey;
        },
        /**
         * @function getCache
         * @description Retrieves a cached config value from NS cache.
         * @param {Object} [option] - Options passed to `generateCacheKey` if no key is set
         * @returns {Object|null} Cached config data, or `null` if not found
         */
        getCache: function (option) {
            var cacheKey = this.CacheKey || this.generateCacheKey(option);
            return vclib_util.getNSCache({ name: cacheKey, isJSON: true });
        },
        /**
         * @function setCache
         * @description Stores a config value in NS cache under the current cache key.
         * @param {Object} cacheValue - The config data to cache
         * @returns {void}
         */
        setCache: function (cacheValue) {
            if (vclib_util.isEmpty(cacheValue)) return;
            var cacheKey = this.CacheKey || this.generateCacheKey();

            vclib_util.setNSCache({ name: cacheKey, value: cacheValue });
        },
        /**
         * @function removeCache
         * @description Removes the cached config value from NS cache.
         * @param {Object} [option] - Options passed to `generateCacheKey` if no key is set
         * @returns {void}
         */
        removeCache: function (option) {
            var cacheKey = this.CacheKey || this.generateCacheKey(option);
            return vclib_util.removeCache({ name: cacheKey });
        }
    };

    var MainConfigLib = vclib_util.extend(ConfigLib, {
        ConfigType: ListConfigType.MAIN,
        SkippedFields: ['custrecord_ctc_vc_license_text'],
        ConfigNameValue: 'MAIN CONFIG',
        ConfigNameField: 'custrecord_ctc_vc_xml_vendor',
        /**
         * @function load
         * @description Loads the Main Config record. Checks the NS cache first;  if not
         *   cached, runs an NS search and populates the config data object. Caches the
         *   result on successful load.
         * @param {Object} [option] - Options
         * @param {boolean} [option.forceReload=false] - Bypass cache and force reload
         * @returns {Object|false} Config data object, or `false` if not found/error
         */
        load: function (option) {
            var logTitle = [LogTitle, 'MainConfigLib.load'].join('::'),
                returnValue;
            option = option || {};

            vclib_util.LogPrefix = '[' + this.ConfigNameValue + '] ';

            if (ENABLE_LOG) vclib_util.log(logTitle, '// main option: ', option);

            try {
                var configMap = vc2_constant.MAPPING[this.ConfigType],
                    configData = {};

                /// build the search option
                var searchOption = this.buildSearchOption(option);

                var cachedValue = this.getCache(option);
                if (!vclib_util.isEmpty(cachedValue)) {
                    returnValue = cachedValue;
                    return cachedValue;
                }
                if (ENABLE_LOG) vclib_util.log(logTitle, '**** LOADING CONFIG: START ****');

                var searchObj = ns_search.create(searchOption);
                if (!searchObj) return false;

                searchObj.run().each(function (row) {
                    configData.name = row.getValue({ name: 'name' });
                    for (var field in configMap) {
                        var value = row.getValue({ name: configMap[field] });
                        configData[field] = !vclib_util.isEmpty(value)
                            ? value.value || value
                            : null;
                    }
                    return true;
                });

                if (!vclib_util.isEmpty(configData)) this.setCache(configData);

                returnValue = configData;
            } catch (error) {
                // skip logging errors created within this function
                if (!Helper.isInternalError(error)) {
                    vclib_util.logError(logTitle, error);
                }
                throw error;
            } finally {
                //if (ENABLE_LOG) vclib_util.log(logTitle, '## CONFIG: ', [
                //     returnValue,
                //     this.CacheParams,
                //     this.CacheKey
                // ]);

                vclib_util.LogPrefix = ''; // reset the log
            }
            return returnValue;
        }
    });

    var OrderConfigLib = vclib_util.extend(ConfigLib, {
        ConfigType: ListConfigType.VENDOR,
        ConfigNameValue: 'VENDOR CONFIG',
        ConfigNameField: 'custrecord_ctc_vc_xml_vendor',
        SkippedFields: ['custrecord_ctc_vc_xml_req'],
        CountryCodeField: VENDOR_CFG.FIELD.SUBSIDIARY,
        /**
         * @function buildSearchOption
         * @description Builds the NS search options for the Order/Vendor Config record.
         *   Resolves the appropriate vendor and subsidiary from the provided options or
         *   by looking up the referenced PO. Applies filters for vendor, subsidiary, and
         *   config ID as needed. Sets `CacheParams` for cache key generation.
         * @param {Object} [option] - Options
         * @param {string|number} [option.id] - Config record internal ID (direct lookup)
         * @param {string|number} [option.poId] - PO internal ID (resolved to vendor/subsidiary)
         * @param {string} [option.poNum] - PO transaction ID (resolved to vendor/subsidiary)
         * @param {string|number} [option.vendorId] - Vendor internal ID filter
         * @param {string|number} [option.subsidiaryId] - Subsidiary internal ID filter
         * @returns {Object} NS search options `{ type, filters, columns }`
         */
        buildSearchOption: function (option) {
            var logTitle = [LogTitle, 'OrderConfigLib.buildSearchOption'].join('::');
            option = option || {};

            var configId = option.configId || option.id,
                vendorId = option.vendor || option.vendorId,
                subsidiaryId = option.subsidiary || option.subsidiaryId,
                poNum = option.poNum || option.tranid || option.tranId,
                poId = option.poId,
                recordData = option.recordData;

            if (ENABLE_LOG) vclib_util.log(logTitle, '// option [ORDER CFG]: ', option);

            // reset the params
            this.CacheParams = [];
            this.CacheKey = null;

            var searchOption = ConfigLib.buildSearchOption({ configType: ListConfigType.VENDOR });

            // ADD the COUNTRY from either the subsidiary or the VENDOR
            searchOption.columns.push(VENDOR_CFG.FIELD.SUBSIDIARY + '.country');

            // if the configId is specified, exit the script immediately
            if (configId) {
                searchOption.filters.push('AND', ['internalid', 'anyof', configId]);
                this.CacheParams.push('configId=' + configId);

                if (option.debugMode) {
                    this.CacheParams.push('debugMode=T');
                    return searchOption;
                }
                // return searchOption;
            }

            if (!vendorId && (poId || poNum)) {
                var MainCFG = EndPoint.mainConfig();

                if (!recordData) {
                    recordData = vcs_recordLib.searchTransaction({
                        name: poNum,
                        id: poId,
                        type: ns_record.Type.PURCHASE_ORDER,
                        overridePO: MainCFG.overridePONum,
                        columns: [
                            'entity',
                            'internalid',
                            'vendor.internalid',
                            'vendor.entityid',
                            'vendor.custentity_vc_bill_config',
                            vclib_util.isOneWorld() ? 'subsidiary' : null,
                            vclib_util.isOneWorld() ? 'subsidiary.country' : null
                        ]
                    });
                }

                if (recordData && !vclib_util.isEmpty(recordData)) {
                    vendorId = recordData.entity
                        ? recordData.entity.value || recordData.entity
                        : null;
                    subsidiaryId = recordData.subsidiary
                        ? recordData.subsidiary.value || recordData.subsidiary
                        : null;
                    this.CacheParams.push('poId=' + recordData.id);
                    this.CacheParams.push('poNum=' + recordData.tranid);
                }
            }
            // else throw ERROR_MSG.MISSING_VENDOR_CONFIG_OR_INVALID_PO;

            if (vendorId) {
                searchOption.filters.push('AND', [VENDOR_CFG.FIELD.VENDOR, 'anyof', vendorId]);
                this.CacheParams.push('vendorId=' + vendorId);
            }
            // vclib_util.log(logTitle, '// subsidiaryId: ', vc2_constant.GLOBAL);

            if (vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES && subsidiaryId) {
                searchOption.filters.push('AND', [
                    VENDOR_CFG.FIELD.SUBSIDIARY,
                    'anyof',
                    subsidiaryId
                ]);
                this.CacheParams.push('subsidiaryId=' + subsidiaryId);
            }

            if (!this.CacheParams.length) throw ERROR_MSG_OLD.MISSING_VENDOR_CONFIG_OR_INVALID_PO;

            // vclib_util.log(logTitle, '// searchoption: ', searchOption);

            return searchOption;
        },
        setCache: function (cacheValue) {
            if (vclib_util.isEmpty(cacheValue)) return;
            var cacheKey = this.CacheKey || this.generateCacheKey();

            // save it first
            vclib_util.setNSCache({ name: cacheKey, value: cacheValue });

            vclib_util.saveCacheList({
                listName: vc2_constant.CACHE_KEY.VENDOR_CONFIG,
                cacheKey: cacheKey
            });

            return true;
        },
        removeCache: function (option) {
            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.VENDOR_CONFIG });
        }
    });

    var BillConfigLib = vclib_util.extend(ConfigLib, {
        ConfigType: ListConfigType.BILL,
        SkippedFields: [],
        ConfigNameValue: 'BILLCREATE CONFIG',
        ConfigNameField: 'custrecord_vc_bc_xmlapi_vendor',
        /**
         * @function buildSearchOption
         * @description Builds the NS search options for the Bill Vendor Config record.
         *   Resolves vendor and subsidiary from the referenced PO when no direct config ID
         *   is given. Sets `CacheParams` for cache key generation.
         * @param {Object} [option] - Options
         * @param {string|number} [option.id] - Config record internal ID (direct lookup)
         * @param {string|number} [option.poId] - PO internal ID (resolved to vendor)
         * @param {string} [option.poNum] - PO transaction ID (resolved to vendor)
         * @param {string|number} [option.subsidiaryId] - Subsidiary internal ID filter
         * @returns {Object} NS search options `{ type, filters, columns }`
         */
        buildSearchOption: function (option) {
            var logTitle = [LogTitle, 'BillConfigLib.buildSearchOption'].join('::');
            option = option || {};

            var configId = option.configId || option.id,
                subsidiaryId = option.subsidiary || option.subsidiaryId,
                poNum = option.poNum || option.tranid || option.tranId,
                poId = option.poId,
                recordData = option.recordData;

            if (ENABLE_LOG) vclib_util.log(logTitle, '// option [BILL CFG]: ', option);

            this.CacheParams = [];
            this.CacheKey = null;

            var searchOption = ConfigLib.buildSearchOption({ configType: ListConfigType.BILL });

            if (configId) {
                searchOption.filters.push('AND', ['internalid', 'anyof', configId]);
                this.CacheParams.push('configId=' + configId);
                return searchOption;
            }

            if (!configId && (poId || poNum)) {
                if (!recordData) {
                    var MainCFG = EndPoint.mainConfig();
                    recordData = vcs_recordLib.searchTransaction({
                        name: poNum,
                        id: poId,
                        type: ns_record.Type.PURCHASE_ORDER,
                        overridePO: MainCFG.overridePONum,
                        columns: [
                            'entity',
                            'internalid',
                            'vendor.internalid',
                            'vendor.entityid',
                            'vendor.custentity_vc_bill_config',
                            vclib_util.isOneWorld() ? 'subsidiary' : null
                        ]
                    });
                }
                if (recordData && !vclib_util.isEmpty(recordData)) {
                    this.CacheParams.push('poId=' + recordData.id);
                    this.CacheParams.push('poNum=' + recordData.tranid);

                    configId = recordData.custentity_vc_bill_config
                        ? recordData.custentity_vc_bill_config.value ||
                          recordData.custentity_vc_bill_config
                        : null;
                    var vendorId = recordData.entity
                        ? recordData.entity.value || recordData.entity
                        : null;
                    subsidiaryId = recordData.subsidiary
                        ? recordData.subsidiary.value || recordData.subsidiary
                        : null;
                }
            }

            // if the configId is specified, exit the script immediately
            if (configId) {
                var billConfigs = configId.split(/,/);
                searchOption.filters.push('AND', ['internalid', 'anyof', billConfigs]);
                this.CacheParams.push('configId=' + configId);
            }

            if (vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES && subsidiaryId) {
                searchOption.filters.push('AND', [
                    [BILL_CFG.FIELD.SUBSIDIARY, 'anyof', subsidiaryId],
                    'OR',
                    [BILL_CFG.FIELD.SUBSIDIARY, 'noneof', '@NONE@']
                ]);
                this.CacheParams.push('subsidiaryId=' + subsidiaryId);
            }

            if (ENABLE_LOG) vclib_util.log(logTitle, '// params: ', this.CacheParams);

            if (!this.CacheParams.length || !configId)
                throw ERROR_MSG.MISSING_VENDOR_CONFIG_OR_INVALID_PO.code;

            return searchOption;
        },
        /**
         * @function load
         * @description Loads the Bill Vendor Config record matching the given criteria.
         *   Resolves the PO if `poId`/`poNum` is provided, builds the search option,
         *   runs the NS search, and caches the result.
         * @param {Object} [option] - Options
         * @param {string|number} [option.poId] - Internal ID of the PO to resolve
         * @param {string} [option.poNum] - Transaction ID of the PO to resolve
         * @param {string|number} [option.id] - Direct Bill Config record internal ID
         * @param {boolean} [option.forceReload=false] - Bypass cache and force reload
         * @returns {Object|false} Config data object, or `false` if not found/error
         */
        load: function (option) {
            var logTitle = [LogTitle, 'BillConfigLib.load'].join('::'),
                returnValue;
            option = option || {};

            vclib_util.LogPrefix = '[' + this.ConfigNameValue + '] ';
            if (ENABLE_LOG) vclib_util.log(logTitle, '// option [BILL CFG]: ', option);
            if (ENABLE_LOG) vclib_util.log(logTitle, '**** LOADING CONFIG:  BC START ****');

            try {
                var configMap = vc2_constant.MAPPING[this.ConfigType],
                    configData = {},
                    recordData = {};

                // load the current record
                if (option.poId || option.poNum) {
                    recordData = vcs_recordLib.searchTransaction({
                        name: option.poNum,
                        id: option.poId,
                        type: ns_record.Type.PURCHASE_ORDER,
                        columns: [
                            'entity',
                            'internalid',
                            'vendor.internalid',
                            'vendor.entityid',
                            'vendor.custentity_vc_bill_config'
                        ]
                    });
                    option.recordData = recordData;
                }
                var searchOption = this.buildSearchOption(option);

                var cachedValue = this.getCache(option);
                if (!vclib_util.isEmpty(cachedValue)) {
                    returnValue = cachedValue;
                    return cachedValue;
                }

                //if (ENABLE_LOG) vclib_util.log(logTitle, '// searchOption: ', searchOption);
                var searchObj = ns_search.create(searchOption);
                if (!searchObj) return false;

                searchObj.run().each(function (row) {
                    for (var field in configMap) {
                        var value = row.getValue({ name: configMap[field] });
                        configData[field] = !vclib_util.isEmpty(value)
                            ? value.value || value
                            : null;
                    }
                    return true;
                });

                if (!vclib_util.isEmpty(configData)) this.setCache(configData);

                returnValue = configData;
            } catch (error) {
                // skip logging errors created within this function
                if (!Helper.isInternalError(error)) {
                    vclib_util.logError(logTitle, error);
                }
                throw error;
            } finally {
                //if (ENABLE_LOG) vclib_util.log(logTitle, '**** LOADING CONFIG: END ****', [
                //     returnValue,
                //     this.CacheParams,
                //     this.CacheKey
                // ]);
                vclib_util.LogPrefix = ''; // reset the log prefix
            }
            return returnValue;
        },
        setCache: function (cacheValue) {
            if (vclib_util.isEmpty(cacheValue)) return;
            var cacheKey = this.CacheKey || this.generateCacheKey();

            // save it first
            vclib_util.setNSCache({ name: cacheKey, value: cacheValue });

            vclib_util.saveCacheList({
                listName: vc2_constant.CACHE_KEY.BILLCREATE_CONFIG,
                cacheKey: cacheKey
            });
        },
        removeCache: function (option) {
            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.BILLCREATE_CONFIG });
        }
    });

    var SendPOConfigLib = vclib_util.extend(ConfigLib, {
        ConfigType: ListConfigType.SENDPO,
        ConfigNameValue: 'SENDPO VENDOR CONFIG',
        ConfigNameField: 'custrecord_ctc_vcsp_api_vendor',
        /**
         * @function buildSearchOption
         * @description Builds the NS search options for the Send PO Vendor Config record.
         *   Resolves vendor and subsidiary from the referenced PO when no direct config ID
         *   is given. Sets `CacheParams` for cache key generation.
         * @param {Object} [option] - Options
         * @param {string|number} [option.id] - Config record internal ID (direct lookup)
         * @param {string|number} [option.poId] - PO internal ID (resolved to vendor/subsidiary)
         * @param {string} [option.poNum] - PO transaction ID (resolved to vendor/subsidiary)
         * @param {string|number} [option.vendorId] - Vendor internal ID filter
         * @param {string|number} [option.subsidiaryId] - Subsidiary internal ID filter
         * @returns {Object} NS search options `{ type, filters, columns }`
         */
        buildSearchOption: function (option) {
            var logTitle = [LogTitle, 'SendPOConfigLib.buildSearchOption'].join('::');
            option = option || {};

            var configId = option.configId || option.id,
                vendorId = option.vendor || option.vendorId,
                subsidiaryId = option.subsidiary || option.subsidiaryId,
                poNum = option.poNum || option.tranid || option.tranId,
                poId = option.poId;

            if (ENABLE_LOG) vclib_util.log(logTitle, '// option [SENDPO CFG]: ', option);

            var searchOption = ConfigLib.buildSearchOption({ configType: ListConfigType.SENDPO });

            // if the configId is specified, exit the script immediately
            if (configId) {
                searchOption.filters.push('AND', ['internalid', 'anyof', configId]);
                this.CacheParams.push('configId=' + configId);
                return searchOption;
            }

            var recordData = {};
            if (!vendorId && (poId || poNum)) {
                var MainCFG = EndPoint.mainConfig();

                recordData = vcs_recordLib.searchTransaction({
                    name: poNum,
                    id: poId,
                    type: ns_record.Type.PURCHASE_ORDER,
                    overridePO: MainCFG.overridePONum,
                    columns: [
                        'entity',
                        'internalid',
                        'vendor.internalid',
                        'vendor.entityid',
                        'vendor.custentity_vc_bill_config'
                    ]
                });

                if (recordData && !vclib_util.isEmpty(recordData)) {
                    this.CacheParams.push('poId=' + recordData.id);
                    this.CacheParams.push('poNum=' + recordData.tranid);

                    vendorId = recordData.entity
                        ? recordData.entity.value || recordData.entity
                        : null;
                    subsidiaryId = recordData.subsidiary
                        ? recordData.subsidiary.value || recordData.subsidiary
                        : null;
                }
            }
            // else throw ERROR_MSG.MISSING_VENDOR_CONFIG_OR_INVALID_PO;

            if (vendorId) {
                searchOption.filters.push('AND', [SENDPOVND_CFG.FIELD.VENDOR, 'anyof', vendorId]);
                this.CacheParams.push('vendorId=' + vendorId);
            }

            if (vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES && subsidiaryId) {
                searchOption.filters.push('AND', [
                    SENDPOVND_CFG.FIELD.SUBSIDIARY,
                    'anyof',
                    subsidiaryId
                ]);
                this.CacheParams.push('subsidiaryId=' + subsidiaryId);
            }

            if (!this.CacheParams.length) throw ERROR_MSG_OLD.MISSING_VENDOR_CONFIG_OR_INVALID_PO;

            //if (ENABLE_LOG) vclib_util.log(logTitle, '// searchoption: ', searchOption);
            //if (ENABLE_LOG) vclib_util.log(logTitle, '// CacheParams: ', this.CacheParams);

            return searchOption;
        },
        setCache: function (cacheValue) {
            if (vclib_util.isEmpty(cacheValue)) return;

            var cacheKey = this.CacheKey || this.generateCacheKey();

            // save it first
            vclib_util.setNSCache({ name: cacheKey, value: cacheValue });

            vclib_util.saveCacheList({
                listName: vc2_constant.CACHE_KEY.SENDPOVND_CONFIG,
                cacheKey: cacheKey
            });
        },
        removeCache: function (option) {
            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.SENDPOVND_CONFIG });
        }
    });

    var EndPoint = {
        ConfigType: ListConfigType,
        /**
         * @function loadConfig
         * @description Loads a VC configuration record of the specified type.
         *   Delegates to the appropriate config library based on `configType`.
         * @param {Object} option - Load options
         * @param {string} [option.configType] - One of `ListConfigType` values (MAIN|VENDOR|BILL|SENDPO). Defaults to MAIN.
         * @param {string|number} [option.poId] - Internal ID of the Purchase Order to resolve vendor config
         * @param {string} [option.poNum] - Transaction number of the PO
         * @param {boolean} [option.nocache] - Skip cache and force a fresh load
         * @returns {Object|false} Config data object, or `false`/`undefined` on failure
         */
        loadConfig: function (option) {
            var logTitle = [LogTitle, 'loadConfig'].join('::'),
                returnValue;
            option = option || {};
            var configType = option.configType || ListConfigType.MAIN;

            vclib_util.log(logTitle, 'option: ', option);
            try {
                // load the config based on the type
                switch (configType) {
                    case ListConfigType.MAIN:
                        return MainConfigLib.load(option);
                    case ListConfigType.VENDOR:
                        return OrderConfigLib.load(option);
                    case ListConfigType.BILL:
                        return BillConfigLib.load(option);
                    case ListConfigType.SENDPO:
                        return SendPOConfigLib.load(option);
                    default:
                        throw 'Invalid config type';
                }
            } catch (error) {
                if (Helper.isInternalError(error)) {
                    // logs errors created within this function as warnings
                    vclib_util.logWarn(logTitle, error);
                } else {
                    vclib_util.logError(logTitle, error);
                }
            }

            return returnValue;
        },
        /**
         * @function searchConfig
         * @description Searches for all config records of the given type and returns a list.
         *   Unlike `loadConfig`, this returns all matches rather than the first.
         * @param {Object} option - Search options
         * @param {string} [option.configType] - One of `ListConfigType` values (MAIN|VENDOR|BILL|SENDPO). Defaults to MAIN.
         * @param {string|number} [option.poId] - Internal ID of the PO to scope the search
         * @param {string} [option.poNum] - Transaction number to scope the search
         * @param {boolean} [option.nocache] - Skip cache
         * @returns {Array|false} Array of config data objects, or `false` on failure
         */
        searchConfig: function (option) {
            var logTitle = [LogTitle, 'searchConfig'].join('::'),
                returnValue = null;
            option = option || {};

            try {
                var configType = option.configType || ListConfigType.MAIN;

                var configMap = {};

                configMap[ListConfigType.MAIN] = MainConfigLib;
                configMap[ListConfigType.VENDOR] = OrderConfigLib;
                configMap[ListConfigType.BILL] = BillConfigLib;
                configMap[ListConfigType.SENDPO] = SendPOConfigLib;

                if (!configMap[configType]) throw 'Invalid config type';

                returnValue = configMap[configType].search(option);
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        /**
         * @function removeConfigCache
         * @description Clears the NS cache for the specified config type.
         * @param {Object} option - Options
         * @param {string} [option.configType] - One of `ListConfigType` values (MAIN|VENDOR|BILL|SENDPO). Defaults to MAIN.
         * @returns {void}
         */
        removeConfigCache: function (option) {
            var logTitle = [LogTitle, 'removeConfigCache'].join('::');
            option = option || {};
            var configType = option.configType || this.ConfigType.MAIN;

            // remove the config cache based on the type
            switch (configType) {
                case ListConfigType.MAIN:
                    return MainConfigLib.removeCache(option);
                case ListConfigType.VENDOR:
                    return OrderConfigLib.removeCache(option);
                case ListConfigType.BILL:
                    return BillConfigLib.removeCache(option);
                case ListConfigType.SENDPO:
                    return SendPOConfigLib.removeCache(option);
                default:
                    throw 'Invalid config type';
            }
        },
        /**
         * @function sendConfig
         * @description Sends the specified config record data to the Catalyst license server.
         * @param {Object} option - Options
         * @param {string} [option.configType] - One of `ListConfigType` values (MAIN|VENDOR|BILL|SENDPO). Defaults to MAIN.
         * @param {string|number} [option.configId] - Internal ID of the config record to send
         * @returns {Object|false} Server response object, or `false` on failure
         */
        sendConfig: function (option) {
            var logTitle = [LogTitle, 'sendConfig'].join('::');
            option = option || {};
            var configType = option.configType || this.ConfigType.MAIN;

            // send config data to the license server based on config type
            switch (configType) {
                case ListConfigType.MAIN:
                    return MainConfigLib.send(option);
                case ListConfigType.VENDOR:
                    return OrderConfigLib.send(option);
                case ListConfigType.BILL:
                    return BillConfigLib.send(option);
                case ListConfigType.SENDPO:
                    return SendPOConfigLib.send(option);
                default:
                    throw 'Invalid config type';
            }
        },
        /**
         * @function mainConfig
         * @description Shortcut to load the VAR Connect Main Configuration record.
         * @param {Object} [option] - Options passed through to `MainConfigLib.load`
         * @param {boolean} [option.nocache] - Skip cache lookup
         * @returns {Object|undefined} Main config data object, or `undefined` on error
         */
        mainConfig: function (option) {
            var logTitle = [LogTitle, 'mainConfig'].join('::'),
                returnValue;
            option = option || {};

            try {
                returnValue = MainConfigLib.load(option);
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return returnValue;
        },
        /**
         * @function orderVendorConfig
         * @description Shortcut to load the Order Vendor Configuration for a given PO.
         * @param {Object} [option] - Options
         * @param {string|number} [option.poId] - Internal ID of the Purchase Order
         * @param {string} [option.poNum] - Transaction number of the PO
         * @param {boolean} [option.nocache] - Skip cache lookup
         * @returns {Object|undefined} Order vendor config data object, or `undefined` on error
         */
        orderVendorConfig: function (option) {
            var logTitle = [LogTitle, 'orderVendorConfig'].join('::'),
                returnValue;
            option = option || {};
            try {
                returnValue = OrderConfigLib.load(option);
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return returnValue;
        },
        /**
         * @function billVendorConfig
         * @description Shortcut to load the Bill Vendor Configuration for a given PO.
         * @param {Object} [option] - Options
         * @param {string|number} [option.poId] - Internal ID of the Purchase Order
         * @param {string} [option.poNum] - Transaction number of the PO
         * @param {boolean} [option.nocache] - Skip cache lookup
         * @returns {Object|undefined} Bill vendor config data object, or `undefined` on error
         */
        billVendorConfig: function (option) {
            var logTitle = [LogTitle, 'billVendorConfig'].join('::'),
                returnValue;
            option = option || {};
            try {
                returnValue = BillConfigLib.load(option);
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return returnValue;
        },
        /**
         * @function sendPOVendorConfig
         * @description Shortcut to load the Send PO Vendor Configuration for a given PO.
         * @param {Object} [option] - Options
         * @param {string|number} [option.poId] - Internal ID of the Purchase Order
         * @param {string} [option.poNum] - Transaction number of the PO
         * @param {boolean} [option.nocache] - Skip cache lookup
         * @returns {Object|undefined} Send PO vendor config data object, or `undefined` on error
         */
        sendPOVendorConfig: function (option) {
            var logTitle = [LogTitle, 'sendPOVendorConfig'].join('::'),
                returnValue;
            option = option || {};
            try {
                returnValue = SendPOConfigLib.load(option);
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return returnValue;
        },
        /**
         * @function validateLicense
         * @description Validates the VAR Connect license against the Catalyst license server.
         *   Uses NS cache to avoid repeated HTTP calls. Retries up to 3 times on failure.
         * @param {Object} [option] - Unused; reserved for future use
         * @returns {Object} License info `{ status, hasError, errorMsg, ... }`;
         *   check `returnValue.hasError` to determine validity
         */
        validateLicense: function (option) {
            var logTitle = [LogTitle, 'validateLicense'].join('::'),
                returnValue;

            try {
                var servResponse = LibLicense.validate({ doRetry: true, maxRetry: 3 });
                //if (ENABLE_LOG) vclib_util.log(logTitle, 'servResponse: ', servResponse);
                returnValue = servResponse;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = { hasError: true };
            }

            return returnValue;
        },
        /**
         * @function sendVendorConfig
         * @description Sends the Order Vendor Config record data to the license server.
         * @param {Object} option - Options
         * @param {string|number} option.recordId - Internal ID of the Order Vendor Config record
         * @returns {true}
         */
        sendVendorConfig: function (option) {
            var logTitle = [LogTitle, 'sendVendorConfig'].join('::');
            option = option || {};
            try {
                OrderConfigLib.send({ id: option.recordId || option.id });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return true;
        },
        /**
         * @function sendBillConfig
         * @description Sends the Bill Vendor Config record data to the license server.
         * @param {Object} option - Options
         * @param {string|number} option.recordId - Internal ID of the Bill Vendor Config record
         * @returns {true}
         */
        sendBillConfig: function (option) {
            var logTitle = [LogTitle, 'sendBillConfig'].join('::');
            option = option || {};
            try {
                BillConfigLib.send({ id: option.recordId || option.id });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return true;
        },
        /**
         * @function sendMainConfig
         * @description Sends the Main Config record data to the license server.
         * @param {Object} option - Options
         * @param {string|number} option.recordId - Internal ID of the Main Config record
         * @returns {true}
         */
        sendMainConfig: function (option) {
            var logTitle = [LogTitle, 'sendMainConfig'].join('::');
            option = option || {};
            try {
                MainConfigLib.send({ id: option.recordId || option.id });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }
            return true;
        },
        /**
         * @function purgeCache
         * @description Clears NS cache for all config types (MAIN, VENDOR, BILL, SENDPO).
         * @returns {true}
         */
        purgeCache: function (option) {
            var logTitle = [LogTitle, 'purgeCache'].join('::');

            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.MAIN_CONFIG });
            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.VENDOR_CONFIG });
            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.BILLCREATE_CONFIG });
            vclib_util.deleteCacheList({ listName: vc2_constant.CACHE_KEY.SENDPOVND_CONFIG });

            return true;
        }
    };

    //add alias for backward compatibility
    EndPoint.vendorConfig = EndPoint.orderVendorConfig;

    return EndPoint;
});
