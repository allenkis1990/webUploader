

define(['angular', 'webuploader'],
    function (angular, WebUploader) {
        'use strict';
        var HB_WebUploader = angular.module('hb.webUploader', []);
        HB_WebUploader.run(['HB_WebUploaderService', '$log', '$rootScope', 'HB_WebUploader',
            function (HB_WebUploaderService, $log, $rootScope, HB_WebUploader) {
                HB_WebUploaderService.doSpecialLog('当前分片每片' + WebUploader.Base.formatSize(HB_WebUploaderService.chunkSize) + '起', 'darkblue');
                HB_WebUploaderService.doSpecialLog('注册分片上传以及秒传，断点续传功能....', 'pink');
                HB_WebUploaderService.uploadConfigOptions = $rootScope.uploadConfigOptions;
            }]);
        HB_WebUploader.provider('HB_WebUploader', [function () {
            var resource = {};
            this.setResourceInfo = function (url) {
                return ['$http', '$q', function ($http, $q) {
                    var defer = $q.defer();
                    $http.get(url)
                        .success(function (data) {
                            resource = data.info;
                            defer.resolve(data);
                        })
                        .error(function (data) {
                            defer.resolve(undefined);
                        });
                    return defer.promise;
                }];
            };
            this.$get = [function () {
                return {
                    getResourceInfo: function () {
                        return resource;
                    }
                };
            }]
        }]);
        HB_WebUploader.factory('HB_WebUploaderService', HB_WebUploaderService);
        HB_WebUploaderService.$inject = ['$timeout', '$log'];
        function HB_WebUploaderService($timeout, $log) {
            var _HB_WebUploaderService = {
                standard: 'small',
                superBigFileSize: 1610612736, // 1.5G
                smallFileStandard: 5242880 * 2, //10M小文件定义
                chunkSize: 52428800, // 分片大小50m
                //prefixUrl: 'http://192.168.1.99:8080/resource-web',
                fileImageType: 'jpg,jpeg,gif,png',
                HB_WU_S: {},
                CURRENT_HB_WU: null
            };

            _HB_WebUploaderService.doSpecialLog = function (msg, type) {
                $log.log('%c' + msg, 'color:' + type);
            };


            //如果已上传过的文件或者分片直接触发完成的一系列方法
            _HB_WebUploaderService.uploadComplete = function (file, response) {
                _HB_WebUploaderService.CURRENT_HB_WU.trigger("uploadProgress", file, 1);
                _HB_WebUploaderService.CURRENT_HB_WU.trigger("uploadComplete", file);//触发已上传事件
                _HB_WebUploaderService.CURRENT_HB_WU.trigger("uploadSuccess", file, response);//触发上传成功事件
                _HB_WebUploaderService.CURRENT_HB_WU.trigger("uploadFinished", file);//触发上传完成事件
            };

            _HB_WebUploaderService.checkIsBigFile = function (fileSize) {
                // 大于10m的统一是大文件
                return fileSize >= _HB_WebUploaderService.smallFileStandard;
            };

            _HB_WebUploaderService.isIe = function () {
                return (function (ua) {
                    var ie = ua.match(/MSIE\s([\d\.]+)/) ||
                        ua.match(/(?:trident)(?:.*rv:([\w.]+))?/i);
                    return ie && parseFloat(ie[1]);
                })(navigator.userAgent);
            };

            _HB_WebUploaderService.registerBigFileUpload = function (options) {
                _HB_WebUploaderService.md5CheckUrl = options.md5CheckPath;
                _HB_WebUploaderService.blockMd5CheckUrl = options.blockMd5CheckPath;
                _HB_WebUploaderService.uploadBigFileUrl = options.uploadBigFilePath;
                _HB_WebUploaderService.uploadSmallFileUrl = options.resourceServicePath;

                var md5Object = new WebUploader.Runtime.Html5.Md5({});


                //分别检验整个文件的md5和分片的md5是否已存在服务端了
                //如果存在直接不上传并且task.reject(); 如果不存在就上传 task.resolve();
                WebUploader.Uploader.register(
                    {
                        'before-send-file': 'beforeSendFile',
                        'before-send': 'beforeSend'
                    }, {
                        beforeSendFile: function (file) {// 在文件开始发送前进行MD5校验异步操作。是否可以秒传钩子要在create之前注册
                            var task = $.Deferred(),
                                fileSize = file.size;
                            console.log(777);
                            file.guid = WebUploader.Base.guid();
                            $timeout(function () {
                                file.liveStatus = 1;
                            });
                            // 如果文件大小不超过10M的直接不执行md5或者断点续传，或者分片上传

                            file.md5 = md5Object.md5String([file.lastModifiedDate.getTime(), file.name, file.size].join('-'));

                            if (_HB_WebUploaderService.checkIsBigFile(fileSize) && !_HB_WebUploaderService.isIe()) {

                                _HB_WebUploaderService.doSpecialLog('文件大小超过10M,并且开始执行文件的第一次md5计算', 'red');
                                var fileName = file.name;
                                $.ajax({
                                    type: "post",
                                    url: _HB_WebUploaderService.md5CheckUrl,
                                    data: {
                                        md5: file.md5,
                                        guid: file.guid,
                                        originalFileName: fileName,
                                        context: options.context,
                                        requestContext: options.requestContext
                                    }, cache: false,
                                    dataType: "json",
                                    success: function (data) {
                                        if (data.exists) {   //若存在，这返回失败给WebUploader，表明该文件不需要上传
                                            _HB_WebUploaderService.doSpecialLog('服务器存在计算完成的文件的md5，不执行上传，实现秒传', 'red');
                                            _HB_WebUploaderService.uploadComplete(file, data);
                                            _HB_WebUploaderService.CURRENT_HB_WU.skipFile(file);
                                            task.reject();
                                            file.newPath = data.newPath;
                                        } else {
                                            task.resolve();
                                        }
                                    }, error: function () {
                                        task.resolve();
                                    }
                                });
                            } else {
                                $timeout(function () {
                                    file.liveStatus = 2;
                                });
                                task.resolve();
                            }
                            return $.when(task);
                        },
                        beforeSend: function (block) {//分片文件发送之前计算分片文件的MD5,并且验证该分片是否需要上传
                            var task = $.Deferred();
                            if (_HB_WebUploaderService.checkIsBigFile(block.file.size) && !_HB_WebUploaderService.isIe()) {
                                block.file.chunkMd5 = md5Object.md5String([block.file.lastModifiedDate.getTime(), block.file.name, block.chunk, block.file.size].join('-'));
                                var fileName = block.file.name;
                                var data = {
                                        md5: block.file.md5,
                                        guid: block.file.guid,
                                        originalFileName: fileName,
                                        size: block.file.size,
                                        context: options.context,
                                        requestContext: options.requestContext
                                    },
                                    chunks = block.chunks,
                                    chunk = block.chunk;
                                if (chunks > 1) {
                                    data.chunks = chunks;//分片数
                                    data.chunk = chunk;//当前分片号
                                    data.chunkMd5 = block.file.chunkMd5;//分片文件的md5
                                    data.chunkSize = block.blob.size;//分片文件大小
                                    $.ajax({
                                        type: "post",
                                        url: _HB_WebUploaderService.blockMd5CheckUrl,
                                        data: data,
                                        cache: false,
                                        dataType: "json"
                                    }).then(function (data) {
                                        if (data.exists) {
                                            task.reject();
                                        } else {
                                            task.resolve();
                                        }
                                    }, function () {
                                        task.resolve();
                                    });
                                } else {
                                    task.resolve();
                                }
                            } else {
                                task.resolve();
                            }
                            return $.when(task);
                        }
                    });
            };
            return _HB_WebUploaderService;
        }

        /**
         * 文件生命过程
         * file.liveStatus {
         *                  -1,  --> 上传失败
         *                  0,   --> 文件添加到队列当中，并没有做任何操作
         *                  1,   --> 文件正在执行整个文件的md5File操作
         *                  2,   --> 整个文件的md5File成功准备上传
         *                  3,   --> 文件上传百分比完成，等待服务器响应
         *                  4    --> 文件上传百分比完成并且服务器响应成功
         *               }
         */
        HB_WebUploader.directive('hbFileUploader', HB_FileUploaderDirective);
        HB_FileUploaderDirective.$inject = ['HB_WebUploaderService', '$timeout', '$log', '$parse', '$rootScope', 'HB_WebUploader'];
        function HB_FileUploaderDirective(HB_WebUploaderService, $timeout, $log, $parse, $rootScope, HB_WebUploader) {
            return {
                restrict: 'AE',
                require: '?^ngModel',
                scope: {
                    onProgress: '&',
                    onSuccess: '&',
                    onFileQueued: '&',
                    onFileTypeDenied: '&',
                    onUploadStart: '&',
                    onUploadStop: '&',
                    onSave: '&',
                    multi: '=',
                    returnIsArray: '@',
                    // 大文件定义大于10M的为大文件
                    standard: '@', //big、small
                    sizeLimit: '@',
                    accepts: '@', // 'jpg,ext,txt'
                    hbFileUploader: '='
                },
                link: function ($scope, $element, $attr, ngModelController) {
                    if (!ngModelController) {
                        return false;
                    }

                    $scope.$on('$destroy', function () {
                        ngModelController.$setViewValue('');
                        if (HB_WebUploaderService.CURRENT_HB_WU !== null) {
                            HB_WebUploaderService.CURRENT_HB_WU.stop(true);
                        }

                        ngModelController.$setValidity('required', false);
                    });

                    function isAssignable(attrs, propertyName) {
                        var fn = $parse(attrs[propertyName]);
                        return angular.isFunction(fn.assign);
                    }

                    // 如果开始上传设置为多文件上传， 则将ngModel设置为数组
                    if ($scope.multi) {
                        !ngModelController.$modelValue && !angular.isArray(ngModelController.$modelValue) && (ngModelController.$setViewValue([]));
                    }
                    var resource = HB_WebUploader.getResourceInfo();

                    if (!HB_WebUploader.registered) {
                        HB_WebUploaderService.registerBigFileUpload(resource);
                    }
                    HB_WebUploader.registered = true;

                    // 默认为小文件上传
                    var uploadUrl = resource.resourceServicePath,
                        flashMode = HB_WebUploaderService.isIe();
                    if (!HB_WebUploaderService.isIe() && checkIsBigStandard()) {
                        uploadUrl = resource.uploadBigFilePath;
                    }

                    function checkIsBigStandard() {
                        return $scope.standard === 'big';
                    }

                    function setModelValue(response) {
                        response = angular.fromJson(response.raw);
                        if (angular.isArray(ngModelController.$viewValue)) {
                            ngModelController.$viewValue.push(response);
                        } else if (angular.isObject(ngModelController.$viewValue)) {
                            ngModelController.$setViewValue(response);
                        } else {
                            if ($scope.multi) {
                                ngModelController.$viewValue.push(response);
                            } else {
                                ngModelController.$setViewValue(response);
                            }
                        }
                    }

                    var chunkSize = HB_WebUploaderService.chunkSize, HB_WU,
                        defaultConfiguration = {
                            pick: {
                                id: $element.attr('id') ? '#' + $element.attr('id') : $element,
                                innerHTML: $attr.buttonText || '选择文件',
                                multiple: false
                            },
                            timeout: 0,
                            formData: {
                                context: resource.context,
                                requestContext: resource.requestContext
                            },
                            compress: false,
                            fileSizeLimit: $scope.sizeLimit,
                            auto: $scope.multi ? false : true,
                            swf: '/bower_components/webuploader_fex/dist/Uploader.swf',
                            server: uploadUrl + '?uploadSync=true',
                            // 上传最大并发数: 默认---3
                            threads: 1
                        };

                    if (flashMode) {
                        HB_WebUploaderService.doSpecialLog('当前模式为ie， flash专享模式', 'red');
                        defaultConfiguration.runtimeOrder = 'flash';
                    } else {
                        if (checkIsBigStandard()) {
                            defaultConfiguration.chunked = true;
                            defaultConfiguration.chunkRetry = 0;//启用分片
                            defaultConfiguration.chunkSize = chunkSize;//分片大小50MB
                        }
                    }

                    if ($scope.accepts) {
                        defaultConfiguration.accept = {
                            title: 'files',
                            extensions: $scope.accepts
                        }
                    }

                    HB_WU = WebUploader.create(defaultConfiguration);

                    HB_WU.on('uploadProgress', function (file, percentage) {
                        var nowPercentage = percentage * 100;
                        if (nowPercentage === 100) {
                            $timeout(function () {
                                file.liveStatus = 3;
                            });
                        }
                        $timeout(function () {
                            file.progress = (nowPercentage).toFixed(2);
                        });
                        $scope.onProgress && $scope.onProgress({percentage: percentage});
                    });

                    HB_WU.on('uploadSuccess', function (file, response) {
                        HB_WebUploaderService.doSpecialLog('上传成功....', '#449d44');
                        file.uploadSuccess = true;
                        $scope.onSuccess && $scope.onSuccess({file: file});

                        !$scope.multi && HB_WU.reset();
                        $timeout(function () {
                            // 服务器响应成功设置字段为响应成功。
                            file.liveStatus = 4;
                            file.newPath = response.newPath;
                            file.raw = response._raw;
                            file.uploadStatus = 3;
                            setModelValue(file);
                        })
                    });

                    HB_WU.on('beforeFileQueued', function () {
                        if (!uploadUrl) {
                            HB_WU.option('server',
                                $rootScope.uploadConfigOptions && ($rootScope.uploadConfigOptions.uploadImageUrl + '?uploadSync=true'));
                        }
                    });

                    HB_WU.on('stopUpload', function (file) {
                        $scope.onUploadStart && $scope.onUploadStop({file: file});
                        HB_WebUploaderService.doSpecialLog('停止上传.....', '#c9302c');
                    });

                    HB_WU.on('uploadStart', function (file) {
                        HB_WebUploaderService.doSpecialLog('开始上传.....', '#286090');
                        $scope.onUploadStart && $scope.onUploadStart({file: file});
                        $timeout(function () {
                            file.uploadBegin = true;
                            file.uploadStatus = 1;
                        })
                    });

                    HB_WU.on('error', function (file) {
                        //console.log ( 123132 );
                    });

                    //文件上传之前加上guid和md5,有分片的包括分片的md5
                    HB_WU.on('uploadBeforeSend', function (object, data, headers) {
                        if ((HB_WebUploaderService.checkIsBigFile(object.file.size) || checkIsBigStandard()) && !HB_WebUploaderService.isIe()) {
                            var chunks = object.chunks,
                                chunk = object.chunk;
                            HB_WebUploaderService.doSpecialLog('当前分片数' + object.chunks, 'pink');
                            data.guid = object.file.guid;//整个文件guid
                            data.md5 = object.file.md5;//整个文件的md5
                            data.originalFileName = object.file.name;//原文件名

                            if (chunks > 1) {//有分片的时候要把分片数以及当前分片号,以及分片的md5和当前分片的大小传上去
                                data.chunks = chunks;//分片数
                                data.chunk = chunk;//当前分片号
                                data.chunkMd5 = object.file.chunkMd5;//分片文件的md5
                                data.chunkSize = object.blob.size;//分片文件大小
                            }
                        }
                    });

                    function isMd5ing(value) {
                        return value === 1;
                    }



                    //把hbFileUploader设置成hbFileUploader:'='  hb-file-uploader='lwh' 实现手动上传
                    //只要调用$scope.lwh里的方法就可以了 比如$scope.lwh.uploadOne()
                    if (isAssignable($attr, 'hbFileUploader')) {
                        $scope.hbFileUploader = {
                            localFileQueue: [],
                            name: 'hbWebUploader',
                            uploadOne: function (file) {
                                $timeout(function () {
                                    HB_WebUploaderService.CURRENT_HB_WU = HB_WU;
                                    HB_WebUploaderService.CURRENT_HB_WU.upload(file);
                                    file.uploadStatus = 1;
                                })
                            },
                            save: function () {
                                HB_WebUploaderService.CURRENT_HB_WU = HB_WU;
                                var files = HB_WebUploaderService.CURRENT_HB_WU.getFiles();
                                if (files.length <= 0) {
                                    HB_WebUploaderService.doSpecialLog('上传文件队列不能为空....', 'red');
                                    return false;
                                }
                                HB_WebUploaderService.CURRENT_HB_WU.upload();
                            },
                            removeOne: function (file, removeIndex) {
                                if (isMd5ing(file.liveStatus)) {
                                    HB_WebUploaderService.doSpecialLog('文件正在md5校验不能从队列中删除....', 'red');
                                    return false;
                                }
                                if (file.liveStatus === 2) {
                                    window.confirm('文件正在上传确定要从队列中删除?', function () {
                                        doDelete();
                                    });
                                    return false;
                                }
                                doDelete();
                                function doDelete() {
                                    HB_WebUploaderService.CURRENT_HB_WU = HB_WU;
                                    HB_WebUploaderService.CURRENT_HB_WU.removeFile(file);
                                    $scope.hbFileUploader.localFileQueue.splice(removeIndex, 1);
                                }
                            },
                            reupload: function (file) {

                                HB_WebUploaderService.CURRENT_HB_WU = HB_WU;
                                HB_WebUploaderService.CURRENT_HB_WU.retry(file);

                            },
                            stopAll: function () {
                                HB_WebUploaderService.CURRENT_HB_WU = HB_WU;
                                HB_WebUploaderService.CURRENT_HB_WU.stop(true);
                            },
                            stopOne: function (file) {
                                // 当文件正在md5校验的时候， 不能进行暂停操作
                                if (isMd5ing(file.liveStatus)) {
                                    HB_WebUploaderService.doSpecialLog('文件正在md5校验，请等待校验结束再进行暂停操作!', 'red');
                                    return false;
                                }
                                $timeout(function () {
                                    HB_WebUploaderService.CURRENT_HB_WU = HB_WU;
                                    HB_WebUploaderService.CURRENT_HB_WU.stop(file);
                                    // 0 为还没有上传,1 为正在上传 2为暂停上传 3, 为上传完成
                                    file.uploadStatus = 2;
                                });
                            }
                        };
                    }
                    /**
                     *file对象存在文件循环引用， toJson的时候会报错。 暂不知道怎么解决
                     */
                    HB_WU.on('fileQueued', function (file) {
                        console.log(file);
                        var isIe = HB_WebUploaderService.isIe();
                        var isBig = HB_WebUploaderService.checkIsBigFile(file.size);
                        if (HB_WebUploaderService.superBigFileSize < file.size && isIe) {
                            window.alert('想体验超爽超大文件上传，请用chrome或者firefox主流浏览器....');
                            return false;
                        }
                        if (isBig && (!$scope.standard || $scope.standard !== 'big') && !HB_WebUploaderService.isIe()) {
                            HB_WebUploaderService.doSpecialLog('当前上传文件大小定义属于大文件，请配置规格standard为big模式.....', 'red');
                            return false;
                        }

                        if ($scope.standard === 'big' && !isBig && !HB_WebUploaderService.isIe()) {
                            HB_WebUploaderService.doSpecialLog('当前上传文件大小定义属于小文件，请配置规格standard为small模式或者不配置.....', 'red');
                            return false;
                        }

                        file.guid = WebUploader.Base.guid();
                        file.queueId = $attr.queueid;
                        file.formatSize = WebUploader.Base.formatSize(file.size);
                        file.progress = 0;
                        file.uploadStatus = 0;
                        file.uploadBegin = false;
                        file.liveStatus = 0;//  0刚加入队列 1,准备md5file， 2-md5结束并且正在上传， 3-上传完成

                        if ($scope.multi) {
                            $scope.$apply(function () {
                                if ($scope.hbFileUploader && $scope.hbFileUploader.localFileQueue && angular.isArray($scope.hbFileUploader.localFileQueue)) {
                                    $scope.hbFileUploader.localFileQueue.push(file)
                                }
                            })
                        } else {
                            if ($scope.hbFileUploader) {
                                $scope.hbFileUploader.selectFile = file;
                            }
                        }
                        $scope.onFileQueued && $scope.onFileQueued();
                    });

                    HB_WU.on('error', function (error) {
                        if ($attr.onError) {
                            $scope.onError({
                                $info: {
                                    error: error,
                                    uploader: this
                                }
                            })
                        }
                        switch (error) {
                            case 'Q_TYPE_DENIED':
                                var accept = this.options.accept;
                                var message = '请上传:';
                                var accepts = '';
                                angular.forEach(accept, function (item) {
                                    accepts += item.extensions;
                                });
                                message += accepts + '的文件类型';
                                if ($attr.onFileTypeDenied) {
                                    $scope.onFileTypeDenied({
                                        $info: {
                                            accepts: accepts,
                                            uploader: this
                                        }
                                    });
                                } else {
                                    alert(message)
                                }
                                break;
                            case 'Q_EXCEED_SIZE_LIMIT':
                                alert('文件不能超过' + WebUploader.Base.formatSize($scope.sizeLimit));
                                break;
                        }

                    });

                    HB_WU.on('uploadError', function (file, error) {
                        $timeout(function () {
                            file.liveStatus = -1;
                        });
                        $log.log('%c上传过程中出现错误' + error, 'color:red');
                    })
                }
            }
        }
    });
