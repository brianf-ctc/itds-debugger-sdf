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
 * Script Name: VC Lib | Error Handling Library
 *
 * @author brianf@nscatalyst.com
 * @description Unified error interpretation, formatting, and logging utility that supports
 * built-in and custom error mappings with ErrorLevel constants (ERROR, WARNING, CRITICAL).
 * Provides chainable ErrorResult API and helper functions for consistent error handling patterns.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-16   brianf                Added INFO error level handling in write() to log via audit with [INFO] prefix
 * 2026-03-13   brianf                Fixed write() prefix appended to logTitle; added registered.msg/error aliases in extract(); replaced typeof with ns_util.isObject
 * 2026-03-12   brianf                Initial build; aligned JSDoc to ErrorLibObj/EndPoint API and refreshed header/sample usage documentation
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var ns_log = require('N/log'),
        ns_runtime = require('N/runtime'),
        ns_util = require('N/util');

    var ERROR_LEVEL = {
        INFO: 'INFO',
        ERROR: 'ERROR',
        WARNING: 'WARNING',
        CRITICAL: 'CRITICAL'
    };

    // ─── Built-in error codes ─────────────────────────────────────────────────
    var ERROR_MAP = {
        UNEXPECTED_ERROR: {
            code: 'UNEXPECTED_ERROR',
            message: 'An unexpected error occurred',
            level: ERROR_LEVEL.ERROR
        },
        MISSING_PARAMETER: {
            code: 'MISSING_PARAMETER',
            message: 'Missing required parameter',
            level: ERROR_LEVEL.ERROR
        },
        INVALID_VALUE: {
            code: 'INVALID_VALUE',
            message: 'Invalid parameter value',
            level: ERROR_LEVEL.ERROR
        }
    };

    // ─── Internal helpers ─────────────────────────────────────────────────────
    var Helper = {
        /**
         * Returns remaining governance units as a formatted prefix string.
         * @returns {string}
         */
        getUsage: function () {
            try {
                var rem = ns_runtime.getCurrentScript().getRemainingUsage();
                return '[usage:' + rem + ']';
            } catch (e) {
                return '';
            }
        },

        /**
         * Extracts a standardized error object { code, message, detail, level, raw } from any
         * thrown value (string code, string message, plain object, or NS SuiteScriptError).
         * Lookup order (no map merging): customErrorMap → ERROR_MAP → generic fallback.
         * @param {*} error
         * @param {Object} [customErrorMap]  Object map: { CODE: { code, message, level }, ... }
         * @returns {{ code: string, message: string, detail: *, level: string, raw: * }}
         */
        extract: function (error, customErrorMap) {
            var code = null,
                message = null,
                detail = null,
                level = ERROR_LEVEL.ERROR;

            if (ns_util.isString(error)) {
                // Could be a code or a bare message string
                code = error;
                message = error;
            } else if (typeof error == 'object') {
                code = error.code || error.errorCode || error.name || null;
                message = error.msg || error.message || error.errorMsg || error.error || null;
                detail =
                    error.detail ||
                    error.details ||
                    (error.fileName ? error.fileName + '#' + error.lineNumber : null) ||
                    error.stack ||
                    null;
                level = error.level || ERROR_LEVEL.ERROR;
            }

            customErrorMap = (error && error.errorMap) || customErrorMap;

            // Look up registered entry in precedence order — no map merge needed
            var registered = null;
            if (code) {
                registered = (customErrorMap && customErrorMap[code]) || ERROR_MAP[code];
            }
            if (registered) {
                message = registered.message || registered.msg || registered.error || message;
                level = registered.level || level;
            }

            return {
                code: code || 'UNEXPECTED_ERROR',
                message: message || 'An unexpected error occurred',
                detail: detail,
                level: (level || ERROR_LEVEL.ERROR).toUpperCase(),
                raw: error
            };
        },

        /**
         * Formats a standardized error object into a human-readable string and caches the result
         * on the object as `errorObj.errorMessage` for convenient reuse by callers.
         * Format: "CODE: message" or "CODE: message - detail"
         * @param {{ code: string, message: string, detail: * }} errorObj
         * @returns {string} Formatted error string; also stored as errorObj.errorMessage
         */
        format: function (errorObj) {
            var message = errorObj && errorObj.message;

            if (errorObj.detail) {
                var detailStr =
                    typeof errorObj.detail === 'string'
                        ? errorObj.detail
                        : JSON.stringify(errorObj.detail);
                message += ' - ' + detailStr;
            }

            var fullMessage = message;
                // errorObj.code && errorObj.code !== errorObj.message
                //     ? errorObj.code + ': ' + message
                //     : message;

            errorObj.errorMessage = fullMessage;
            errorObj.message = message;

            return fullMessage;
        },

        write: function (option, logTitleOverride, levelOverride) {
            option = option || {};

            var logTitle =
                    logTitleOverride ||
                    (option && (option.title || option.logTitle)) ||
                    'Error Report Log',
                prefix = (option && option.prefix) || '',
                level = levelOverride || (option && (option.errorLevel || option.level)),
                errorMsg = option && (option.message || option.errorMessage),
                errorBody = '';

            var usage = Helper.getUsage();

            switch (level ? level.toUpperCase() : ERROR_LEVEL.ERROR) {
                case ERROR_LEVEL.INFO:
                    prefix = prefix || '[INFO]';
                    errorBody = [usage + prefix, errorMsg].join(' ');
                    ns_log.audit(logTitle, errorBody);
                    break;
                case ERROR_LEVEL.WARNING:
                    prefix = prefix || ' [WARNING]';
                    errorBody = [usage + prefix, errorMsg].join(' ');
                    ns_log.audit(logTitle + prefix, errorBody);
                    break;
                case ERROR_LEVEL.CRITICAL:
                    prefix = prefix || '[CRITICAL]';
                    errorBody = [usage + prefix, errorMsg].join(' ');
                    ns_log.error(logTitle, errorBody);
                    break;
                case ERROR_LEVEL.ERROR:
                default:
                    prefix = prefix || '[ERROR]';
                    errorBody = [usage + prefix, errorMsg].join(' ');
                    ns_log.error(logTitle, errorBody);
                    break;
            }

            return true;
        }
    };

    /**
     * ErrorLibObj: Chainable wrapper for normalized error objects.
     * @constructor ErrorLibObj
     * @param {Object} [option] - Configuration with title and errorMap.
     */
    var ErrorLibObj = function (option) {
        option = option || {};

        this.title = option && option.title;
        this.errorMap = option && option.errorMap;

        return this;
    };

    /**
     * Interprets an error object using built-in and custom error mappings.
     * @param {*} option - Error object/message to interpret.
     * @param {Object} [customErrorMap] - Custom error code map: { CODE: { code, message, level }, ... }.
     * @returns {ErrorLibObj} Returns this for chaining.
     */
    ErrorLibObj.prototype.interpret = function (option, customErrorMap) {
        option = option || {};

        var activeErrorMap = customErrorMap || (option && option.errorMap) || this.errorMap;

        var errorObj = Helper.extract(option.error || option, activeErrorMap);
        var formattedMessage = Helper.format(errorObj);

        ns_util.extend(this, {
            code: (errorObj && errorObj.code) || option.errorCode || option.code,
            message: (errorObj && errorObj.message) || option.errorMessage || option.message,
            detail: (errorObj && errorObj.detail) || option.detail || option.details,
            raw: errorObj && errorObj.raw,
            level:
                (errorObj && errorObj.level) ||
                option.errorLevel ||
                option.level ||
                ERROR_LEVEL.ERROR,
            errorMessage: formattedMessage || option.errorMessage
        });

        return this;
    };

    /**
     * Logs the error at ERROR level to N/log
     * @param {string} [logTitle] - Optional override for log title
     * @returns {ErrorLibObj} - Returns this for chaining
     */
    ErrorLibObj.prototype.log = function (logTitle) {
        // Helper.format(this);
        Helper.write(this, logTitle);
        return this;
    };

    /**
     * Logs the error at WARNING level to N/log
     * @param {string} [logTitle] - Optional override for log title
     * @returns {ErrorLibObj} - Returns this for chaining
     */
    ErrorLibObj.prototype.warn = function (logTitle) {
        // Helper.format(this);
        Helper.write(this, logTitle, ERROR_LEVEL.WARNING);
        return this;
    };

    /**
     * Logs the error at CRITICAL level to N/log
     * @param {string} [logTitle] - Optional override for log title
     * @returns {ErrorLibObj} - Returns this for chaining
     */
    ErrorLibObj.prototype.critical = function (logTitle) {
        // Helper.format(this);
        Helper.write(this, logTitle, ERROR_LEVEL.CRITICAL);
        return this;
    };

    /**
     * EndPoint: Public API for error handling utility.
     * Supports static helpers and chainable ErrorLibObj instances.
     */
    var EndPoint = {
        /**
         * ErrorLevel enum: ERROR | WARNING | CRITICAL
         * @type {Object}
         */
        ErrorLevel: ERROR_LEVEL,

        /**
         * Creates a new ErrorLibObj instance.
         * @param {Object} [option] - Configuration object.
         * @returns {ErrorLibObj} New ErrorLibObj instance.
         */
        init: function (option) {
            return new ErrorLibObj(option);
        },

        /**
         * Interprets and formats an error object.
         * @param {*} option - Error object/message to interpret.
         * @param {Object} [customErrorMap] - Custom error code mappings.
         * @returns {ErrorLibObj} Chainable ErrorLibObj with extracted error data.
         */
        interpret: function (option, customErrorMap) {
            var errorResult = new ErrorLibObj(option);
            errorResult.interpret(option, customErrorMap);
            return errorResult;
        },

        /**
         * Interprets error and logs it at ERROR level.
         * @param {string} [logTitle] - Optional override for log title.
         * @param {*} option - Error object/message to interpret.
         * @param {Object} [customErrorMap] - Custom error code mappings.
         * @returns {ErrorLibObj} Chainable ErrorLibObj.
         */
        log: function (logTitle, option, customErrorMap) {
            var errorResult = new ErrorLibObj(option);
            errorResult.interpret(option, customErrorMap);
            errorResult.log(logTitle);
            return errorResult;
        },

        /**
         * Interprets error and logs it at WARNING level.
         * @param {string} [logTitle] - Optional override for log title.
         * @param {*} option - Error object/message to interpret.
         * @param {Object} [customErrorMap] - Custom error code mappings.
         * @returns {ErrorLibObj} Chainable ErrorLibObj.
         */
        warn: function (logTitle, option, customErrorMap) {
            var errorResult = new ErrorLibObj(option);
            errorResult.interpret(option, customErrorMap);
            errorResult.warn(logTitle);
            return errorResult;
        },

        /**
         * Interprets error and logs it at CRITICAL level.
         * @param {string} [logTitle] - Optional override for log title.
         * @param {*} option - Error object/message to interpret.
         * @param {Object} [customErrorMap] - Custom error code mappings.
         * @returns {ErrorLibObj} Chainable ErrorLibObj.
         */
        critical: function (logTitle, option, customErrorMap) {
            var errorResult = new ErrorLibObj(option);
            errorResult.interpret(option, customErrorMap);
            errorResult.critical(logTitle);
            return errorResult;
        }
    };

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * SAMPLE USAGE
     * ═══════════════════════════════════════════════════════════════════════════════
     *
     * // Example 1: Log a caught exception at ERROR level
     * try {
     *     // some risky code
     * } catch (error) {
     *     vclib_error.log('MyFunction', error);
     * }
     *
     * // Example 2: Log with custom error map
     * var CUSTOM_ERRORS = {
     *     INVALID_PO: {
     *         code: 'INVALID_PO',
     *         message: 'Purchase Order is invalid',
     *         level: vclib_error.ErrorLevel.ERROR
     *     },
     *     VENDOR_TIMEOUT: {
     *         code: 'VENDOR_TIMEOUT',
     *         message: 'Vendor API timeout',
     *         level: vclib_error.ErrorLevel.WARNING
     *     }
     * };
     * vclib_error.warn('ProcessOrder', 'VENDOR_TIMEOUT', CUSTOM_ERRORS);
     *
     * // Example 3: Use chainable API with interpret()
     * var errorObj = vclib_error.interpret(caughtError);
     * errorObj.code;              // extracted error code
     * errorObj.message;           // extracted error message
     * errorObj.detail;            // extracted detail/stack
     * errorObj.errorMessage;      // formatted: "CODE: message - detail"
     * errorObj.log('MyFunc');     // chainable: logs and returns this
     *
     * // Example 4: Chain multiple log levels
     * vclib_error
     *     .interpret(error)
     *     .warn('MyFunc');
     *
     * // Example 5: Create and configure error result
     * var result = vclib_error.init({
     *     title: 'MyTitle',
     *     errorMap: CUSTOM_ERRORS
     * });
     * result.interpret(caughtError, CUSTOM_ERRORS);
     * result.critical('ProcessOrder');
     *
     * // Example 6: Direct static methods (signature: logTitle, option, customErrorMap)
     * vclib_error.log('Title', errorObj);                              // ERROR level
     * vclib_error.warn('Title', errorObj);                             // WARNING level
     * vclib_error.critical('Title', errorObj);                         // CRITICAL level
     * vclib_error.warn('Title', 'VENDOR_TIMEOUT', CUSTOM_ERRORS);      // Code + map lookup
     *
     * // Example 7: Access ErrorLevel constants
     * var level = vclib_error.ErrorLevel.WARNING;      // 'WARNING'
     * var level2 = vclib_error.ErrorLevel.CRITICAL;    // 'CRITICAL'
     *
     * ═══════════════════════════════════════════════════════════════════════════════
     */

    return EndPoint;
});
