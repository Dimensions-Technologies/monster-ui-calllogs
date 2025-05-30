define(function(require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster'),
		moment = require('moment'),
		miscSettings = {},
		requestSettings = {};

	var app = {
		requests: {},

		appFlags: {
			callLogs: {
				devices: []
			}
		},

		subscribe: {
			'callLogs.render': 'callLogsRender'
		},

		callLogsRender: function(args) {
			var self = this;

			// set variables for use elsewhere
			miscSettings = args.miscSettings;
			requestSettings = args.requestSettings;

			self.callLogsGetData(function() {
				self.callLogsRenderContent(args.parent, args.fromDate, args.toDate, args.type, args.callback);
			});
		},

		callLogsGetData: function(globalCallback) {
			var self = this;

			monster.parallel({
				devices: function(callback) {
					self.callLogsListDevices(function(devices) {
						callback && callback(null, devices);
					});
				}
			}, function(err, results) {
				self.appFlags.callLogs.devices = _.keyBy(results.devices, 'id');

				globalCallback && globalCallback();

			});
		},

		callLogsGenerateCallData: function(target, otherLegs, callback) {
			var self = this;

			monster.waterfall([
				function addOtherLegsToCall(next) {
					try {
						var $this = $(target),
							call = $this.data('diag-data');
						call.other_legs = otherLegs;

						next(null, call);
					} catch (e) {
						next(e);
					}
				},
				function encodeCallToBase64(call, next) {
					try {
						var base64EncodedCall = btoa(JSON.stringify(call));

						next(null, call, base64EncodedCall);
					} catch (e) {
						next(e);
					}
				},
				function formatCallData(call, base64EncodedCall, next) {
					var diagnosticData = _.chain([
						{ i18nKey: 'accountId', prop: 'account_id' },
						{ i18nKey: 'fromName', prop: 'from_name' },
						{ i18nKey: 'fromNumber', prop: 'from_number' },
						{ i18nKey: 'toName', prop: 'to_name' },
						{ i18nKey: 'toNumber', prop: 'to_number' },
						{ i18nKey: 'date', prop: 'date' },
						{ i18nKey: 'duration', prop: 'duration' },
						{ i18nKey: 'hangUpCause', prop: 'hangup_cause' },
						{ i18nKey: 'callId', prop: 'call_id' },
						{ i18nKey: 'otherLegCallId', value: call.other_leg_call_id },
						{ i18nKey: 'otherLegs', value: '\n  ' + _.join(otherLegs, '\n  ') },
						{ i18nKey: 'handlingServer', prop: 'handling_server' },
						{ i18nKey: 'timestamp', prop: 'timestamp' },
						{ i18nKey: 'base64Encoded', value: base64EncodedCall }
					])
					.map(function(data) {
						var template = self.getTemplate({
							name: '!' + monster.util.tryI18n(self.i18n.active().callLogs.diagnosticCallData, data.i18nKey),
							data: {
								variable: _.find([
									data.value,
									_.get(call, data.prop),
									''
								], _.isString)
							},
							ignoreSpaces: true
						});
						return template;
					}).join('\n').value();

					next(null, diagnosticData);
				}
			], callback);
		},

		callLogsTriggerCopy: function(target, otherLegs) {
			var self = this;

			if (!target.classList.contains('copy-diag-data')) {
				return;
			}

			self.callLogsGenerateCallData(target, otherLegs, function(err, callData) {
				if (err) {
					return monster.ui.toast({
						type: 'error',
						message: self.i18n.active().callLogs.copyCallDiagError
					});
				}

				var clipboardTarget = $('#call_logs_container .copy-diag-data-target');
				clipboardTarget.data('callData', callData);
				clipboardTarget.trigger('click');
			});
		},

		callLogsRenderContent: function(parent, fromDate, toDate, type, callback) {
			var self = this,
				template,
				defaultDateRange = 1,
				container = parent || $('.right-content'),
				maxDateRange = 31;
		
			if (!toDate && !fromDate) {
				var dates = monster.util.getDefaultRangeDates(defaultDateRange);
				fromDate = dates.from;
				toDate = dates.to;
			}
		
			var tz = monster.util.getCurrentTimeZone(),
				dataTemplate = {
					timezone: 'GMT' + moment().tz(tz).format('Z'),
					type: type || 'today',
					fromDate: fromDate,
					toDate: toDate,
					showFilteredDates: ['thisMonth', 'thisWeek'].indexOf(type) >= 0,
					showReport: monster.config.whitelabel.callReportEmail ? true : false
				};
		
			// Create and show the initial template with spinner
			template = $(self.getTemplate({
				name: 'layout',
				data: {
					...dataTemplate,
					miscSettings: miscSettings
				},
				submodule: 'callLogs'
			}));
			container.empty().append(template);
			
			// show loading spinner and disable all buttons in the btn-group when data is loading
			if(!miscSettings.hideLoadingSpinner) {
				template.find('#spinner').show();
			}
			template.find('.btn-group .btn').prop('disabled', true);

			template.find('.fixed-ranges-date').hide();
			template.find('.download-csv').prop('disabled', true);
			template.find('.reload-cdrs').prop('disabled', true);
			template.find('.search-div .search-query').attr('disabled', true);
			
			template.find('.call-logs-content').hide();
			template.find('.call-logs-loader').hide();

			// set date range and disable date range fields when loading custom data
			if (type == 'custom') {
				template.find('#startDate').val(monster.util.toFriendlyDate(fromDate, 'date'));
				template.find('#startDate').attr('disabled', true);
				template.find('#endDate').val(monster.util.toFriendlyDate(toDate, 'date'));
				template.find('#endDate').attr('disabled', true);
				template.find('.apply-filter').attr('disabled', true);
			}
					
			// fetch the data
			self.callLogsGetCdrs(fromDate, toDate, function(cdrs, nextStartKey, errorCode) {
				cdrs = self.callLogsFormatCdrs(cdrs);
		
				type = type || 'today';

				if (errorCode == '500') {
					
					dataTemplate.cdrs = [];
					dataTemplate.type = type || 'today';
					template = $(self.getTemplate({
						name: 'layout',
						data: {
							...dataTemplate,
							miscSettings: miscSettings
						},
						submodule: 'callLogs'
					}));
					
					var optionsDatePicker = {
						container: template,
						range: maxDateRange
					};
		
					monster.ui.initRangeDatepicker(optionsDatePicker);

					template.find('#startDate').datepicker('setDate', fromDate);
					template.find('#endDate').datepicker('setDate', toDate);

					template.find('#spinner').hide();
					template.find('.call-logs-grid .grid-row .grid-cell').text(self.i18n.active().callLogs.outOfRange);
					template.find('.call-logs-loader').hide();

					self.callLogsBindEvents({
						template: template,
						fromDate: fromDate,
						toDate: toDate
					});

					monster.ui.tooltips(template);

					container.empty().append(template);

					template.find('.grid-row.set-date-range').hide();
					template.find('.download-csv').prop('disabled', true);
					template.find('.reload-cdrs').prop('disabled', true);
					template.find('.search-div .search-query').attr('disabled', true);

				} else {
					// update dataTemplate with the retrieved data and ensure type is correct
					dataTemplate.cdrs = cdrs;
					dataTemplate.type = type || 'today';
		
					// update the template with data
					template = $(self.getTemplate({
						name: 'layout',
						data: {
							...dataTemplate,
							miscSettings: miscSettings
						},
						submodule: 'callLogs'
					}));
		
					monster.ui.tooltips(template);
		
					if (cdrs && cdrs.length) {
						var cdrsTemplate = $(self.getTemplate({
							name: 'cdrsList',
							data: {
								cdrs: cdrs,
								showReport: monster.config.whitelabel.callReportEmail ? true : false,
								enableGoogleIcons: miscSettings.enableGoogleIcons,
								enableDirectionText: miscSettings.enableDirectionText
							},
							submodule: 'callLogs'
						}));
						template.find('.call-logs-grid .grid-row-container')
								.append(cdrsTemplate);
					}
		
					var optionsDatePicker = {
						container: template,
						range: maxDateRange
					};
		
					monster.ui.initRangeDatepicker(optionsDatePicker);
		
					template.find('#startDate').datepicker('setDate', fromDate);
					template.find('#endDate').datepicker('setDate', toDate);
		
					if (!nextStartKey) {
						template.find('.call-logs-loader').hide();
					}
		
					// reapply the active tab after rendering
					template.find('.btn-group .btn').removeClass('active');
					template.find('.btn[data-type="' + type + '"]').addClass('active');

					self.callLogsBindEvents({
						template: template,
						cdrs: cdrs,
						fromDate: fromDate,
						toDate: toDate,
						nextStartKey: nextStartKey
					});
		
					monster.ui.tooltips(template);
		
					// hide the spinner and update container with the new template
					template.find('#spinner').hide();
					container.empty().append(template);

					// disable search and download if there is no data
					if (cdrs.length > 0) {
						template.find('.download-csv').prop('disabled', false);
						template.find('.reload-cdrs').prop('disabled', false);
						template.find('.search-div .search-query').attr('disabled', false);
					} else {
						template.find('.download-csv').prop('disabled', true);
						template.find('.reload-cdrs').prop('disabled', true);
						template.find('.search-div .search-query').attr('disabled', true);
					}

					template.find('.grid-row.set-date-range').hide();

				}

				callback && callback();
			});
		},
		
		
		callLogsBindEvents: function(params) {
			var self = this,
				template = params.template,
				cdrs = params.cdrs,
				fromDate = params.fromDate,
				toDate = params.toDate,
				startKey = params.nextStartKey;

			setTimeout(function() {
				template.find('.search-query').focus();
			});

			template.find('.apply-filter').on('click', function(e) {
				var fromDate = template.find('input.filter-from').datepicker('getDate'),
					toDate = template.find('input.filter-to').datepicker('getDate');

				// call the method without changing the tab
				self.callLogsRenderContent(template.parents('.right-content'), fromDate, toDate, 'custom', function() {
				});
				
			});

			template.find('.fixed-ranges .btn-group button').on('click', function(e) {
				var $this = $(this),
					type = $this.data('type');

				// We don't really need to do that, but it looks better to the user if we still remove/add the classes instantly.
				template.find('.fixed-ranges button').removeClass('active');
				$this.addClass('active');

				if (type != 'custom') {
					// Without this, it doesn't look like we're refreshing the data.
					// Good way to solve it would be to separate the filters from the call logs view, and only refresh the call logs.
					template.find('.call-logs-content').empty();

					var dates = self.callLogsGetFixedDatesFromType(type);
					self.callLogsRenderContent(template.parents('.right-content'), dates.from, dates.to, type);
				} else {
					template.find('.fixed-ranges-date').hide();
					template.find('.custom-range').addClass('active');
					template.find('.search-div .search-query').val('');
					
					template.find('.grid-row').show();
					template.find('.grid-row.no-match').hide();
					template.find('.grid-row.no-cdrs').hide();
					template.find('.call-logs-grid .grid-row-container').hide();
					
					template.find('.call-logs-loader').hide();
					template.find('.download-csv').prop('disabled', true);
					template.find('.reload-cdrs').prop('disabled', true);
					template.find('.search-div .search-query').attr('disabled', true);
				}
			});

			template.find('.download-csv').on('click', function(e) {
				var fromDateTimestamp = monster.util.dateToBeginningOfGregorianDay(fromDate),
					toDateTimestamp = monster.util.dateToEndOfGregorianDay(toDate),
					url = self.apiUrl + 'accounts/' + self.accountId + '/cdrs?created_from=' + fromDateTimestamp + '&created_to=' + toDateTimestamp + '&paginate=false&accept=text/csv&auth_token=' + self.getAuthToken();

				window.open(url, '_blank');
			});

			template.find('.reload-cdrs').on('click', function(e) {
				var activeButtonType = template.find('.btn-group .btn.active').data('type');

				if (activeButtonType == 'custom') {
					var fromDate = template.find('input.filter-from').datepicker('getDate'),
					toDate = template.find('input.filter-to').datepicker('getDate');
					self.callLogsRenderContent(template.parents('.right-content'), fromDate, toDate, 'custom', function() {
					});
				} else {
					var dates = self.callLogsGetFixedDatesFromType(activeButtonType);
					self.callLogsRenderContent(template.parents('.right-content'), dates.from, dates.to, activeButtonType);
				}

			});

			template.find('.search-div input.search-query').on('keyup', function(e) {
				if (template.find('.grid-row-container .grid-row').length > 0) {
					var searchValue = $(this).val().replace(/\|/g, '').toLowerCase(),
						matchedResults = false;

					if (searchValue.length <= 0) {
						template.find('.grid-row-group').show();
						matchedResults = true;
					} else {
						_.each(cdrs, function(cdr) {
							var searchString = (cdr.date + '|' + cdr.fromName + '|' + cdr.fromNumber + '|' + cdr.toName + '|'
											+ cdr.toNumber + '|' + cdr.hangupCause + '|' + cdr.id).toLowerCase(),
								rowGroup = template.find('.grid-row.main-leg[data-id="' + cdr.id + '"]').parents('.grid-row-group');

							if (searchString.indexOf(searchValue) >= 0) {
								matchedResults = true;
								rowGroup.show();
							} else {
								rowGroup.hide();
							}
						});
					}

					if (matchedResults) {
						template.find('.grid-row.no-match').hide();
					} else {
						template.find('.grid-row.no-match').show();
					}
				}
			});

			template.on('click', '.grid-row.main-leg', function(e) {
				var $this = $(this),
					rowGroup = $this.parents('.grid-row-group'),
					callId = $this.data('id'),
					extraLegs = rowGroup.find('.extra-legs'),
					target = e.target;

				if (rowGroup.hasClass('open')) {
					rowGroup.removeClass('open');
					extraLegs.slideUp();

					// Handle copy diagnostic data button
					var otherLegs = $this.data('otherLegs');
					self.callLogsTriggerCopy(target, otherLegs);
				} else {
					// Reset all slidedDown legs
					template.find('.grid-row-group').removeClass('open');
					template.find('.extra-legs').slideUp();

					// Slide down current leg
					rowGroup.addClass('open');
					extraLegs.slideDown();

					if (!extraLegs.hasClass('data-loaded')) {
						self.callLogsGetLegs(callId, function(cdrs) {
							var formattedCdrs = self.callLogsFormatCdrs(cdrs),
							networkTraceRetention = miscSettings.networkTraceRetention;

							function isWithinSixDays(callDate) {
								var currentDate = new Date(),
									sixDaysAgo = new Date(currentDate);
								sixDaysAgo.setDate(currentDate.getDate() - networkTraceRetention);
								return callDate >= sixDaysAgo && callDate <= currentDate;
							}
							
							formattedCdrs.forEach(function(cdr) {
								var callDate = new Date(monster.util.gregorianToDate(cdr.timestamp));
								cdr.showPcapDownload = isWithinSixDays(callDate);
								cdr.enableNetworkTraceDownload = miscSettings.enableNetworkTraceDownload;
								cdr.enableGoogleIcons = miscSettings.enableGoogleIcons;
								cdr.hideDeviceIcons = miscSettings.hideDeviceIcons;
							});

							// Make other legs available when querying but not copying
							var otherLegs = cdrs.map(function(call) { return call.id; });

							// Handle copy diagnostic data button
							$this.data('otherLegs', otherLegs);
							self.callLogsTriggerCopy(target, otherLegs);

							rowGroup.find('.extra-legs')
									.empty()
									.addClass('data-loaded')
									.append($(self.getTemplate({
										name: 'interactionLegs',
										data: {
											cdrs: formattedCdrs,
											miscSettings: miscSettings
										},
										submodule: 'callLogs'
									})));
						});
					} else {
						// Handle copy diagnostic data button
						var otherLegs = $this.data('otherLegs');
						self.callLogsTriggerCopy(target, otherLegs);
					}
				}
			});

			template.on('click', '.grid-cell.actions .details-cdr', function(e) {
				e.stopPropagation();
				var cdrId = $(this).parents('.grid-row').data('id');
				self.callLogsShowDetailsPopup(cdrId);
			});

			if (miscSettings.enableNetworkTraceDownload) {
				template.on('click', '.grid-cell.actions .download-pcap', function(e) {
					e.stopPropagation();
					var cdrId = $(this).parents('.grid-row').data('id');
					self.callLogsGetCallId(cdrId);
				});
			}

			template.on('click', '.grid-cell.report a', function(e) {
				e.stopPropagation();
			});

			function loadMoreCdrs() {
				var loaderDiv = template.find('.call-logs-loader'),
					cdrsTemplate;

				if (startKey) {
					loaderDiv.toggleClass('loading');
					loaderDiv.find('.loading-message > i').toggleClass('fa-spin');
					self.callLogsGetCdrs(fromDate, toDate, function(newCdrs, nextStartKey) {
						newCdrs = self.callLogsFormatCdrs(newCdrs);
						cdrsTemplate = $(self.getTemplate({
							name: 'cdrsList',
							data: {
								cdrs: newCdrs,
								showReport: monster.config.whitelabel.callReportEmail ? true : false,
								enableGoogleIcons: miscSettings.enableGoogleIcons,
								enableDirectionText: miscSettings.enableDirectionText
							},
							submodule: 'callLogs'
						}));

						startKey = nextStartKey;
						if (!startKey) {
							template.find('.call-logs-loader').hide();
						}

						template.find('.call-logs-grid .grid-row-container').append(cdrsTemplate);

						cdrs = cdrs.concat(newCdrs);
						var searchInput = template.find('.search-div input.search-query');
						if (searchInput.val()) {
							searchInput.keyup();
						}

						loaderDiv.toggleClass('loading');
						loaderDiv.find('.loading-message > i').toggleClass('fa-spin');
					}, startKey);
				} else {
					loaderDiv.hide();
				}
			}

			template.find('.call-logs-grid').on('scroll', function(e) {
				var $this = $(this);
				if ($this.scrollTop() === $this[0].scrollHeight - $this.innerHeight()) {
					loadMoreCdrs();
				}
			});

			template.find('.call-logs-loader:not(.loading) .loader-message').on('click', function(e) {
				loadMoreCdrs();
			});

			monster.ui.clipboard(template.find('.copy-diag-data-target'), function(trigger) {
				return $(trigger).data('callData');
			}, self.i18n.active().callLogs.copyCallDiagInfo);
		},

		// Function built to return JS Dates for the fixed ranges.
		callLogsGetFixedDatesFromType: function(type) {
			var self = this,
				from = new Date(),
				to = new Date();

			if (type === 'thisWeek') {
				// First we need to know how many days separate today and monday.
				// Since Sunday is 0 and Monday is 1, we do this little substraction to get the result.
				var day = from.getDay(),
					countDaysFromMonday = (day || 7) - 1;

				from.setDate(from.getDate() - countDaysFromMonday);
			} else if (type === 'thisMonth') {
				from.setDate(1);
			}

			return {
				from: from,
				to: to
			};
		},

		callLogsGetCdrs: function(fromDate, toDate, callback, pageStartKey, retryCount = 3) {
			var self = this,
				fromDateTimestamp = monster.util.dateToBeginningOfGregorianDay(fromDate),
				toDateTimestamp = monster.util.dateToEndOfGregorianDay(toDate),
				filters = {
					'created_from': fromDateTimestamp,
					'created_to': toDateTimestamp,
					'page_size': miscSettings.getRequestPageSize || 50
				};
		
			if (pageStartKey) {
				filters.start_key = pageStartKey;
			}
		
			var apiCall = function() {
				if (miscSettings.enableConsoleLogging) {
					console.log('Getting Call Details');
				}
				self.callApi({
					resource: 'cdrs.listByInteraction',
					data: {
						accountId: self.accountId,
						filters: filters,
						generateError: false
					},
					
					success: function(data, status) {
						callback(data.data, data.next_start_key, null);
					},
					
					error: function(data, status) {
						if (miscSettings.enableConsoleLogging) {
							console.log('Getting Call Details Error');
						}
						if (data.error === "500") {
							if (miscSettings.enableConsoleLogging) {
								console.log("500 error occurred, datastore_missing");
							}
							callback(null, null, '500');
						} else if (data.error === "503") {
							if (miscSettings.enableConsoleLogging) {
								console.log("503 error occurred, retrying...");
							}
							// wait 10 seconds
							setTimeout(function() {
								apiCall();
							}, 10000);
						} else {
							console.error("API call failed:", data);
						}
					}
				});
			};
		
			// Call the API function
			apiCall();
			
		},		
		

		callLogsGetLegs: function(callId, callback) {
			var self = this;

			self.callApi({
				resource: 'cdrs.listLegs',
				data: {
					accountId: self.accountId,
					callId: callId
				},
				success: function(data) {
					callback && callback(data.data);
				}
			});
		},

		callLogsFormatCdrs: function(cdrs) {
			var self = this,
				deviceIcons = {
					'cellphone': 'fa fa-phone',
					'smartphone': 'icon-telicon-mobile-phone',
					'landline': 'icon-telicon-home',
					'mobile': 'icon-telicon-sprint-phone',
					'softphone': 'icon-telicon-soft-phone',
					'sip_device': 'icon-telicon-voip-phone',
					'sip_uri': 'icon-telicon-voip-phone',
					'fax': 'icon-telicon-fax',
					'ata': 'icon-telicon-ata',
					'unknown': 'fa fa-circle'
				};

			return _
				.chain(cdrs)
				.map(function(cdr) {
					var date = cdr.hasOwnProperty('channel_created_time') ? monster.util.unixToDate(cdr.channel_created_time, true) : monster.util.gregorianToDate(cdr.timestamp),
						shortDate = monster.util.toFriendlyDate(date, 'shortDate'),
						time = monster.util.toFriendlyDate(date, 'time'),
						durationMin = parseInt(cdr.duration_seconds / 60).toString(),
						durationSec = (cdr.duration_seconds % 60 < 10 ? '0' : '') + (cdr.duration_seconds % 60),
						hangupI18n = self.i18n.active().hangupCauses,
						isOutboundCall = 'authorizing_id' in cdr && cdr.authorizing_id.length > 0,
						extractSipDestination = _.partial(_.replace, _, /@.*/, ''),
						fromNumber = cdr.caller_id_number || extractSipDestination(cdr.from),
						toNumber = cdr.callee_id_number || _
							.chain(cdr)
							.get('request', cdr.to)
							.thru(extractSipDestination)
							.value(),
						device = _.get(self.appFlags.callLogs.devices, _.get(cdr, 'custom_channel_vars.authorizing_id')),
						base64DiagData = JSON.stringify({
							account_id: self.accountId,
							from_name: (cdr.caller_id_name || ''),
							from_number: fromNumber,
							to_name: (cdr.callee_id_name || ''),
							to_number: toNumber,
							date: shortDate,
							duration: durationMin + ':' + durationSec,
							hangup_cause: (cdr.hangup_cause || ''),
							call_id: cdr.call_id,
							other_leg_call_id: (cdr.other_leg_call_id || ''),
							handling_server: (cdr.media_server || ''),
							timestamp: (cdr.timestamp || '')
						});

					return _.merge({
						id: cdr.id,
						callId: cdr.call_id,
						timestamp: cdr.timestamp,
						date: shortDate,
						time: time,
						fromName: cdr.caller_id_name,
						fromNumber: fromNumber,
						toName: cdr.callee_id_name,
						toNumber: toNumber,
						duration: durationMin + ':' + durationSec,
						hangupCause: _
							.chain(hangupI18n)
							.get([cdr.hangup_cause, 'label'], cdr.hangup_cause)
							.lowerCase()
							.value(),
						// Only display help if it's in the i18n.
						hangupHelp: _.get(hangupI18n, [cdr.hangup_cause, isOutboundCall ? 'outbound' : 'inbound'], ''),
						isOutboundCall: isOutboundCall,
						diagData: base64DiagData
					}, _.has(cdr, 'channel_created_time') && {
						channelCreatedTime: cdr.channel_created_time
					}, !_.isUndefined(device) && {
						formatted: _.merge({
							deviceIcon: deviceIcons[device.device_type],
							deviceTooltip: self.i18n.active().devices.types[device.device_type]
						}, cdr.call_direction === 'inbound' ? {
							fromDeviceName: device.name
						} : {
							toDeviceName: device.name
						})
					});
				})
				// In this automagic function... if field doesn't have channelCreateTime, it's because it's a "Main Leg" (legs listed on the first listing, not details)
				// if it's a "main leg" we sort by descending timestamp.
				// if it's a "detail leg", then it has a channelCreatedTime attribute set, and we sort on this as it's more precise. We sort it ascendingly so the details of the calls go from top to bottom in the UI
				.sort(function(a, b) {
					var isMainLeg = !_.every([a, b], _.partial(_.has, _, 'channelCreatedTime')),
						aTime = isMainLeg ? a.timestamp : b.channelCreatedTime,
						bTime = isMainLeg ? b.timestamp : a.channelCreatedTime;

					return aTime > bTime ? -1
						: bTime < aTime ? 1
						: 0;
				})
				.value();
		},

		callLogsShowDetailsPopup: function(callLogId) {

			var self = this;
			self.callApi({
				resource: 'cdrs.get',
				data: {
					accountId: self.accountId,
					cdrId: callLogId
				},
				success: function(data, status) {
					var template = $(self.getTemplate({
						name: 'detailsPopup',
						submodule: 'callLogs'
					}));

					monster.ui.renderJSON(data.data, template.find('#jsoneditor'));

					monster.ui.dialog(template, { title: self.i18n.active().callLogs.detailsPopupTitle });
				},
				error: function(data, status) {
					monster.ui.alert('error', self.i18n.active().callLogs.alertMessages.getDetailsError);
				}
			});
		},

		callLogsGetCallId: function(callLogId) {
			var self = this;
			self.callApi({
				resource: 'cdrs.get',
				data: {
					accountId: self.accountId,
					cdrId: callLogId
				},
				success: function(data, status) {

					var callId = data.data.call_id,
						timestamp = monster.util.gregorianToDate(data.data.timestamp);

					self.computeHash(callId, function(callIdHash) {

						if (miscSettings.enableConsoleLogging) {
							console.log('callIdHash', callIdHash);
						}
						
						self.downloadNetworkTrace(callId, timestamp, callIdHash);

					});

				},
				error: function(data, status) {
					monster.ui.alert('error', self.i18n.active().callLogs.alertMessages.getDetailsError);
				}
			});
		},
		
		downloadNetworkTrace: function(callId, timestamp, callIdHash) {
			var self = this, 
				apiRoot = requestSettings.getNetworkTrace.apiRoot,
				url = requestSettings.getNetworkTrace.url,
				endpointUrl = apiRoot + url;

			monster.ui.toast({
				type: 'info',
				message: self.i18n.active().callLogs.actions.downloadRequested,
				options: {
					positionClass: 'toast-bottom-right',
					timeOut: 8000,
					extendedTimeOut: 5000,
				}
			});
			
			fetch(endpointUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ call_id: callId, timestamp: timestamp, checksum: callIdHash })
			})
			.then(response => {
				if (!response.ok) {
					throw new Error('Failed to fetch the file');
				}
				return response.blob();
			})
			.then(blob => {
				var url = window.URL.createObjectURL(blob);
				var a = document.createElement('a');
				a.href = url;
				a.download = callId + '.pcap';
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.URL.revokeObjectURL(url);

				monster.ui.toast({
					type: 'info',
					message: self.i18n.active().callLogs.actions.downloadSuccess,
					options: {
						positionClass: 'toast-bottom-right',
						timeOut: 8000,
						extendedTimeOut: 5000,
					}
				});
			})
			.catch(error => {
				monster.ui.toast({
					type: 'error',
					message: self.i18n.active().callLogs.actions.downloadError,
					options: {
						positionClass: 'toast-bottom-right',
						timeOut: 8000,
						extendedTimeOut: 5000,
					}
				});
			});
		},

		callLogsListDevices: function(callback) {
			var self = this;

			self.callApi({
				resource: 'device.list',
				data: {
					accountId: self.accountId,
					filters: {
						paginate: false
					}
				},
				success: function(data) {
					callback && callback(data.data);
				}
			});
		},

		computeHash: function(callId, callback) {

			var key = requestSettings.getNetworkTrace.requestKey,
				encoder = new TextEncoder(),
				data = encoder.encode(callId + key);
		
			crypto.subtle.digest("SHA-256", data)
				.then(function(buffer) {
					var hashedBytes = new Uint8Array(buffer);
					var hexString = Array.from(hashedBytes)
						.map(function(b) { return b.toString(16).padStart(2, '0').toUpperCase(); })
						.join('');
					
					callback && callback(hexString);
				})
				.catch(function(error) {
					console.error("Error Computing Hash:", error);
					callback && callback("");
				});

		}

	};

	return app;
});
