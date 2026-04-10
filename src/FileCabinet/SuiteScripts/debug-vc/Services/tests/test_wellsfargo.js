define(function (require) {
    var LogTitle = 'UT:WFParser';

    var lib_ut = require('./../lib/ctc_vclib_unittest.js'),
        lib_testdata = require('./testdata.js');

    var ns_record = require('N/record'),
        ns_runtime = require('N/runtime'),
        ns_format = require('N/format');

    var vc2_util = require('./../../CTC_VC2_Lib_Utils.js');
    var LibWellsFargo = require('./../../Bill Creator/Vendors/wellsfargo_sftp.js');

    var TESTING = [
        function () {
            vc2_util.log(LogTitle, '*** START Unit Testing: [' + ns_runtime.accountId + ']');

            // open the file
            var fileContent = vc2_util.getFileContent({
                folder: './',
                filename: 'netfile-290796823038.txt'
            });

            // process the file
            LibWellsFargo.extractBills({ content: fileContent });

            return true;
        }
    ];

    return {
        run: function (context) {
            var LogTitle = 'VC:UnitTesting';

            // run all the tests
            TESTING.forEach(function (runTest) {
                runTest();
            });

            return Results;
        }
    };
});
