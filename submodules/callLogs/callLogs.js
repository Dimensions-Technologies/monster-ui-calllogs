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

				var clipboardTarget = $('#calls_grid .copy-diag-data-target');
				clipboardTarget.data('callData', callData);
				clipboardTarget.trigger('click');
			});
		},

		callLogsRenderContent: function(parent, fromDate, toDate, type, callback) {
			var self = this,
				template,
				defaultDateRange = 1,
				container = parent || $('.table-wrapper'),
				maxDateRange = 31;

			// format a time (hours, minutes) according to user setting (12h/24h)
			function formatTimeByUserSetting(hours, minutes) {
				var is12hMode = _.get(monster, 'apps.auth.currentUser.ui_flags.twelve_hours_mode', false),
					suffix = '',
					displayHours = hours;

				if (is12hMode) {
					suffix = hours >= 12 ? ' PM' : ' AM';
					displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
				}

				// 24h: 00–23 with leading zero
				var hoursStr = displayHours < 10 ? '0' + displayHours : displayHours.toString();
				var minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();

				// for 12h mode, timepicker uses `g:i A` (no leading zero on hour)
				if (is12hMode) {
					hoursStr = displayHours.toString();
				}

				return hoursStr + ':' + minutesStr + (is12hMode ? suffix : '');
			}
		
			if (!toDate && !fromDate) {
				var dates = monster.util.getDefaultRangeDates(defaultDateRange);
				fromDate = dates.from;
				toDate = dates.to;

				fromDate.setHours(0, 0, 0, 0);
    			toDate.setHours(23, 59, 59, 999);
			}
		
			var tz = monster.util.getCurrentTimeZone(),
				dataTemplate = {
					timezone: 'GMT' + moment().tz(tz).format('Z'),
					type: type || 'today',
					fromDate: fromDate,
					toDate: toDate,
					showFilteredDates: ['today', 'thisMonth', 'thisWeek'].indexOf(type || 'today') >= 0,
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
			self.alignHeaderScrollbar(template);

			template.find('.loading-indicator').removeClass('active');
			
			// show loading spinner and disable all buttons in the btn-group when data is loading
			if (!miscSettings.hideLoadingSpinner) {
				template.find('#spinner').show();
			}

			// show loading dots and disable all buttons in the btn-group when data is loading
			if (miscSettings.showLoadingDots) {
				template.find('.loading-indicator').addClass('active');
			}

			template.find('.btn-group .btn').prop('disabled', true);
			template.find('.fixed-ranges-date').hide();
			template.find('.download-csv').prop('disabled', true);
			template.find('.reload-cdrs').prop('disabled', true);
			template.find('.search-div .search-query').attr('disabled', true);
			template.find('.call-logs-grid-wrapper').empty();
			template.find('.call-logs-loader').hide();

			// set date range and disable date range fields when loading custom data
			if (type == 'custom') {
				template.find('#startDate')
					.val(monster.util.toFriendlyDate(fromDate, 'date'))
					.attr('disabled', true);
				template.find('#endDate')
					.val(monster.util.toFriendlyDate(toDate, 'date'))
					.attr('disabled', true);
				template.find('#startTime')
                    .val(formatTimeByUserSetting(0, 0)) // 00:00 or 12:00AM
                    .attr('disabled', true);
                template.find('#endTime') 
                    .val(formatTimeByUserSetting(23, 59)) // 23:59 or 11:59PM
                    .attr('disabled', true);
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

					self.timepicker(template.find('#startTime'), {
						step: 5,
					});
					self.timepicker(template.find('#endTime'), {
						step: 5
					});

					if (type === 'custom') {
						template.find('#startTime').val(
							formatTimeByUserSetting(fromDate.getHours(), fromDate.getMinutes())
						);
						template.find('#endTime').val(
							formatTimeByUserSetting(toDate.getHours(), toDate.getMinutes())
						);
					} else {
						// default full-day range
						template.find('#startTime').val(formatTimeByUserSetting(0, 0)); // 00:00 / 12:00 AM
						template.find('#endTime').val(formatTimeByUserSetting(23, 59)); // 23:59 / 11:59 PM
					}

					template.find('#spinner').hide();
					template.find('.loading-indicator').removeClass('active');
					template.find('.call-logs-grid .grid-row .grid-cell').text(self.i18n.active().callLogs.outOfRange);
					template.find('.call-logs-loader').hide();

					self.callLogsBindEvents({
						template: template,
						fromDate: fromDate,
						toDate: toDate
					});

					monster.ui.tooltips(template);

					container.empty().append(template);
					self.alignHeaderScrollbar(template);

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
								enableSipFlow: miscSettings.enableSipFlow,
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

					self.timepicker(template.find('#startTime'), {
						step: 5
					});
					self.timepicker(template.find('#endTime'), {
						step: 5
					});

					if (type === 'custom') {
						template.find('#startTime').val(
							formatTimeByUserSetting(fromDate.getHours(), fromDate.getMinutes())
						);
						template.find('#endTime').val(
							formatTimeByUserSetting(toDate.getHours(), toDate.getMinutes())
						);
					} else {
						// default full-day range
						template.find('#startTime').val(formatTimeByUserSetting(0, 0)); // 00:00 / 12:00 AM
						template.find('#endTime').val(formatTimeByUserSetting(23, 59)); // 23:59 / 11:59 PM
					}
					
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
					template.find('.loading-indicator').removeClass('active');
					container.empty().append(template);
					self.alignHeaderScrollbar(template);

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

		// align header scrollbar spacer with actual scrollbar width
		alignHeaderScrollbar: function(template) {
			var self = this;
			var $template = template instanceof jQuery ? template : $(template);
			var $wrapper = $template.find('.call-logs-grid-wrapper');
			if (!$wrapper.length) {
				return;
			}

			var wrapperEl = $wrapper.get(0);
			var scrollbarWidth = wrapperEl ? (wrapperEl.offsetWidth - wrapperEl.clientWidth) : 0;
			if (!scrollbarWidth || scrollbarWidth < 0) {
				scrollbarWidth = 0;
			}

			// apply padding-right to header-row so columns align with scrolled content
			$template.find('.grid-row.header-row').css('padding-right', scrollbarWidth + 'px');
		},

		callLogsBindEvents: function(params) {
			var self = this,
				template = params.template,
				cdrs = params.cdrs,
				fromDate = params.fromDate,
				toDate = params.toDate,
				startKey = params.nextStartKey,
				progressIndicatorStyleId = 'calllogs-extra-legs-progress-style';

			function injectHideProgressIndicatorStyle() {
				if (miscSettings.hideProgressIndicator) {
					if (!document.getElementById(progressIndicatorStyleId)) {
						$('head').append(
							$('<style>', {
								id: progressIndicatorStyleId,
								text: '.progress-indicator.active { display: none !important; }'
							})
						);
					}
				}
			}

			function removeHideProgressIndicatorStyle() {
				if (miscSettings.hideProgressIndicator) {
					$('#' + progressIndicatorStyleId).remove();
				}
			}

			setTimeout(function() {
				template.find('.search-query').focus();
			});

			// ensure header scrollbar spacer is aligned now and on resize
			self.alignHeaderScrollbar(template);
			$(window).off('resize.callLogsScrollbar').on('resize.callLogsScrollbar', function() {
				self.alignHeaderScrollbar(template);
			});

			template.find('.apply-filter').on('click', function(e) {
				var range = getDateTimeFromInputs(template);

				self.callLogsRenderContent(
					template.parents('.table-wrapper'),
					range.from,
					range.to,
					'custom',
					function() {}
				);
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
					self.callLogsRenderContent(template.parents('.table-wrapper'), dates.from, dates.to, type);
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

			/*
			template.find('.download-csv').on('click', function(e) {
				var fromDateTimestamp = monster.util.dateToBeginningOfGregorianDay(fromDate),
					toDateTimestamp = monster.util.dateToEndOfGregorianDay(toDate),
					url = self.apiUrl + 'accounts/' + self.accountId + '/cdrs?created_from=' + fromDateTimestamp + '&created_to=' + toDateTimestamp + '&paginate=false&accept=text/csv&auth_token=' + self.getAuthToken();

				window.open(url, '_blank');
			});
			*/

			template.find('.download-csv').on('click', function(e) {
				var range  = getDateTimeFromInputs(template),
					from   = range.from,
					to     = range.to;

				if (!from || !to) {
					return;
				}

				var fromDateTimestamp = monster.util.dateToGregorian(from),
					toDateTimestamp   = monster.util.dateToGregorian(to),
					url = self.apiUrl + 'accounts/' + self.accountId + '/cdrs?created_from=' + fromDateTimestamp + '&created_to=' + toDateTimestamp + '&paginate=false&accept=text/csv&auth_token=' + self.getAuthToken();

				// filename formatting
				var userFormat = _.get(monster, 'apps.auth.currentUser.ui_flags.date_format', 'mdy');

				function zeroPad(num) {
					num = num.toString();
					return num.length < 2 ? '0' + num : num;
				}

				function formatDateForFilename(d) {
					var yyyy = d.getFullYear().toString(),
						mm   = zeroPad(d.getMonth() + 1),
						dd   = zeroPad(d.getDate());

					if (userFormat === 'dmy') {
						// DD-MM-YYYY
						return dd + '-' + mm + '-' + yyyy;
					} else if (userFormat === 'ymd') {
						// YYYY-MM-DD
						return yyyy + '-' + mm + '-' + dd;
					}
					// default 'mdy' -> MM-DD-YYYY
					return mm + '-' + dd + '-' + yyyy;
				}

				function formatTimeForFilename(d) {
					// 24h, HHmm, safe for filenames (no colon)
					var hh = zeroPad(d.getHours()),
						min = zeroPad(d.getMinutes());
					return hh + min;
				}

				var filename =
					'call_logs_' +
					formatDateForFilename(from) + '_T' + formatTimeForFilename(from) +
					'_to_' +
					formatDateForFilename(to) + '_T' + formatTimeForFilename(to) +
					'.csv';

				// fetch + blob download
				fetch(url, { method: 'GET' })
					.then(function(response) {
						if (!response.ok) {
							throw new Error('CSV download failed');
						}
						return response.blob();
					})
					.then(function(blob) {
						var csvUrl = URL.createObjectURL(blob),
							a     = document.createElement('a');

						a.href = csvUrl;
						a.download = filename;
						document.body.appendChild(a);
						a.click();
						a.remove();
						URL.revokeObjectURL(csvUrl);
					})
					.catch(function() {
						monster.ui.alert('error', 'Unable to download CSV');
					});
			});

			template.find('.reload-cdrs').on('click', function(e) {
				var activeButtonType = template.find('.btn-group .btn.active').data('type');

				if (activeButtonType == 'custom') {
					var range = getDateTimeFromInputs(template);
					self.callLogsRenderContent(
						template.parents('.table-wrapper'),
						range.from,
						range.to,
						'custom',
						function() {}
					);
				} else {
					var dates = self.callLogsGetFixedDatesFromType(activeButtonType);
					self.callLogsRenderContent(template.parents('.table-wrapper'), dates.from, dates.to, activeButtonType);
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
					removeHideProgressIndicatorStyle();

					// Handle copy diagnostic data button
					var otherLegs = $this.data('otherLegs');
					self.callLogsTriggerCopy(target, otherLegs);
				} else {
					// Reset all slidedDown legs
					template.find('.grid-row-group').removeClass('open');
					template.find('.extra-legs').slideUp();
					removeHideProgressIndicatorStyle();

					// Slide down current leg
					rowGroup.addClass('open');
					extraLegs.slideDown();
					injectHideProgressIndicatorStyle();

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

							removeHideProgressIndicatorStyle();
						});
					} else {
						removeHideProgressIndicatorStyle();

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

			if (miscSettings.enableSipFlow) {
				template.on('click', '.grid-cell.actions .show-sip-flow', function(e) {
					e.stopPropagation();
					self.callLogsShowSipFlow($(this));
				});
			}

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

			function getDateTimeFromInputs(template) {
				var fromDate = template.find('input.filter-from').datepicker('getDate'),
					toDate   = template.find('input.filter-to').datepicker('getDate'),
					fromTime = template.find('input.filter-from-time').val(),
					toTime   = template.find('input.filter-to-time').val();

				function parseTimeString(timeString) {
					if (!timeString) { return null; }

					var trimmed = $.trim(timeString),
						match   = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

					if (!match) {
						return null;
					}

					var hours  = parseInt(match[1], 10),
						minutes = parseInt(match[2], 10),
						suffix  = match[3] ? match[3].toUpperCase() : null;

					if (suffix === 'AM') {
						if (hours === 12) {
							hours = 0;
						}
					} else if (suffix === 'PM') {
						if (hours < 12) {
							hours += 12;
						}
					}

					if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
						return null;
					}

					return {
						hours: hours,
						minutes: minutes
					};
				}

				// Start date/time
				if (fromDate) {
					var parsedFrom = parseTimeString(fromTime);

					if (parsedFrom) {
						fromDate.setHours(parsedFrom.hours, parsedFrom.minutes, 0, 0);
					} else {
						// default to start of day
						fromDate.setHours(0, 0, 0, 0);
					}
				}

				// End date/time
				if (toDate) {
					var parsedTo = parseTimeString(toTime);

					if (parsedTo) {
						toDate.setHours(parsedTo.hours, parsedTo.minutes, 59, 999);
					} else {
						// default to end of day
						toDate.setHours(23, 59, 59, 999);
					}
				}

				return {
					from: fromDate,
					to: toDate
				};
			}

			// validate date range inputs and disable buttons as needed
			template
				template.find('#startDate, #endDate, #startTime, #endTime')
				.on('change keyup', function() {
					validateRangeAndToggleFilter();
				});
			
			template
				.find('#startDate, #endDate')
				.datepicker('option', 'onSelect', function() {
					validateRangeAndToggleFilter();
				});


			validateRangeAndToggleFilter();

			function validateRangeAndToggleFilter() {
				var range    = getDateTimeFromInputs(template),
					$filter  = template.find('.apply-filter'),
					$download = template.find('.download-csv'),
					$reload   = template.find('.reload-cdrs');

				if (!range.from || !range.to) {
					$filter.prop('disabled', true);
					$download.prop('disabled', true);
					$reload.prop('disabled', true);
					return;
				}

				var invalid = false;

				if (range.to <= range.from) {
					invalid = true;
				} else {
					var maxEnd = new Date(range.from.getTime());
					maxEnd.setMonth(maxEnd.getMonth() + 1);

					if (range.to > maxEnd) {
						invalid = true;
					}
				}

				$filter.prop('disabled', invalid);
				$download.prop('disabled', invalid);
				$reload.prop('disabled', invalid);
			}

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
								enableSipFlow: miscSettings.enableSipFlow,
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

			// normalise to full days
			from.setHours(0, 0, 0, 0);
    		to.setHours(23, 59, 59, 999);

			return {
				from: from,
				to: to
			};
		},

		callLogsGetCdrs: function(fromDate, toDate, callback, pageStartKey, retryCount = 3) {
			/*
			var self = this,
				fromDateTimestamp = monster.util.dateToBeginningOfGregorianDay(fromDate),
				toDateTimestamp = monster.util.dateToEndOfGregorianDay(toDate),
				filters = {
					'created_from': fromDateTimestamp,
					'created_to': toDateTimestamp,
					'page_size': miscSettings.getRequestPageSize || 50
				};
			*/

			var self = this,
				fromDateTimestamp = monster.util.dateToGregorian(fromDate),
				toDateTimestamp   = monster.util.dateToGregorian(toDate),
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

		// Entry point for the "SIP flow" action. A single call is spread across several SIP
		// traces (one per leg: carrier leg + one or more device legs). The legs are listed in
		// the CDR's "other legs" (each id prefixed with the YYYYMM partition, e.g.
		// 202606-<call-id>); we strip that prefix and ask the SIP server for the combined trace
		// of every leg, then split/merge it back into one diagram.
		callLogsShowSipFlow: function($trigger) {
			var self = this,
				callSummary = $trigger.data('diag-data') || {},
				cdrId = $trigger.data('id');

			self.callLogsGetLegs(cdrId, function(legs) {
				var callIds = _
					.chain(legs)
					.map('id')
					.map(function(id) { return self.callLogsStripLegPrefix(id); })
					.compact()
					.uniq()
					.value();

				// Fall back to the call's own id if no legs were returned.
				if (_.isEmpty(callIds)) {
					callIds = [ self.callLogsStripLegPrefix(cdrId) ];
				}

				var timestamp = monster.util.gregorianToDate(parseInt(callSummary.timestamp, 10));

				if (miscSettings.enableConsoleLogging) {
					console.log('SIP flow call_ids:', callIds, 'timestamp:', timestamp);
				}

				self.getTextNetworkTrace(callIds, timestamp, function(err, rawText) {
					if (err || !$.trim(rawText || '')) {
						return monster.ui.alert('error', self.i18n.active().callLogs.sipFlow.loadError);
					}

					self.callLogsRenderSipFlow(rawText, callSummary);
				});
			});
		},

		// Strip the YYYYMM- partition prefix from a leg/CDR id, leaving the bare call-id.
		callLogsStripLegPrefix: function(legId) {
			return String(legId == null ? '' : legId).replace(/^\d{6}-/, '');
		},

		// Group a flat list of parsed messages into per-leg flows keyed by Call-ID, preserving
		// the order in which each leg first appears.
		callLogsGroupSipFlowLegs: function(messages) {
			var flowsByCallId = {},
				order = [];

			_.each(messages, function(msg) {
				var callId = msg.callId || '(unknown)';
				if (!_.has(flowsByCallId, callId)) {
					flowsByCallId[callId] = { messages: [] };
					order.push(callId);
				}
				flowsByCallId[callId].messages.push(msg);
			});

			return _.map(order, function(callId) {
				return flowsByCallId[callId];
			});
		},

		// Parse a single raw SIP trace into an ordered list of messages. Each "proto:" line
		// starts a new message:
		//   proto:UDP 2026-06-05T14:27:15.888329Z  87.238.73.129:5060 ---> 192.168.100.101:5060
		callLogsParseSipFlow: function(rawText) {
			var headerRegex = /^proto:(\S+)\s+(\S+)\s+(\S+)\s+--->\s+(\S+)/,
				messages = [],
				current = null;

			function finalize(msg) {
				msg.raw = msg.rawLines.join('\n').replace(/^\n+|\n+$/g, '');

				var startLine = '',
					headers = {};

				_.some(msg.rawLines, function(line) {
					if ($.trim(line) !== '') {
						startLine = $.trim(line);
						return true;
					}
					return false;
				});
				msg.startLine = startLine;

				// Capture the first occurrence of the headers we use for correlation/labelling.
				_.each(msg.rawLines, function(line) {
					var headerMatch = line.match(/^(Call-ID|From|To|CSeq):\s*(.*)$/i);
					if (headerMatch) {
						var key = headerMatch[1].toLowerCase();
						if (!_.has(headers, key)) {
							headers[key] = $.trim(headerMatch[2]);
						}
					}
				});
				msg.callId = headers['call-id'] || '';
				msg.fromHeader = headers.from || '';
				msg.toHeader = headers.to || '';
				msg.cseq = headers.cseq || '';

				var responseMatch = startLine.match(/^SIP\/2\.0\s+(\d{3})\s+(.*)$/);
				if (responseMatch) {
					msg.type = 'response';
					msg.statusCode = responseMatch[1];
					msg.reason = $.trim(responseMatch[2]);
					msg.label = responseMatch[1] + ' ' + msg.reason;
				} else {
					msg.type = 'request';
					msg.method = (startLine.split(/\s+/)[0] || '').toUpperCase();
					msg.label = msg.method;
				}

				messages.push(msg);
			}

			_.each(rawText.split(/\r?\n/), function(line) {
				var headerMatch = line.match(headerRegex);
				if (headerMatch) {
					if (current) {
						finalize(current);
					}
					current = {
						protocol: headerMatch[1],
						timestamp: headerMatch[2],
						src: headerMatch[3],
						dst: headerMatch[4],
						rawLines: []
					};
				} else if (current) {
					current.rawLines.push(line);
				}
			});
			if (current) {
				finalize(current);
			}

			return { messages: messages };
		},

		// Merge per-leg flows into a single, time-ordered model. Endpoints are grouped by host
		// (IP) so the whole call reads as one carrier -> core -> device ladder, and each leg is
		// given its own colour.
		callLogsMergeSipFlows: function(flows) {
			var self = this,
				legColors = [
					'#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
					'#e377c2', '#17becf', '#bcbd22', '#7f7f7f', '#393b79', '#e6550d'
				],
				legs = [],
				messages = [],
				seq = 0;

			function sipUser(header) {
				var match = String(header).match(/sip:([^@>;]+)/i);
				return match ? match[1] : $.trim(String(header).replace(/[<>"]/g, ''));
			}

			_.each(flows, function(flow, legIndex) {
				var color = legColors[legIndex % legColors.length],
					firstRequest = _.find(flow.messages, { type: 'request' }),
					outcome = null;

				// The leg's outcome is the final (>= 200) response seen on the leg.
				_.each(flow.messages, function(msg) {
					if (msg.type === 'response' && parseInt(msg.statusCode, 10) >= 200) {
						outcome = { statusCode: msg.statusCode, reason: msg.reason };
					}
				});

				legs.push({
					index: legIndex,
					color: color,
					callId: _.get(flow.messages, '[0].callId', ''),
					from: firstRequest ? sipUser(firstRequest.fromHeader) : '',
					to: firstRequest ? sipUser(firstRequest.toHeader) : '',
					count: flow.messages.length,
					outcome: outcome
				});

				_.each(flow.messages, function(msg) {
					messages.push(_.assign(msg, {
						legIndex: legIndex,
						legColor: color,
						seq: seq++
					}));
				});
			});

			// Sort by absolute time, falling back to original sequence for identical timestamps.
			messages.sort(function(a, b) {
				var ta = Date.parse(a.timestamp),
					tb = Date.parse(b.timestamp);
				return ta !== tb ? ta - tb : a.seq - b.seq;
			});

			// Stable id for each message, used as the diagram's data-index. It has to survive the
			// leg filter re-rendering only a subset of the messages, so it is assigned post-sort
			// and always indexes into this (complete) list.
			_.each(messages, function(msg, i) {
				msg.index = i;
			});

			return {
				actors: self.callLogsSipFlowActors(messages),
				messages: messages,
				legs: legs
			};
		},

		// Columns of the ladder: unique hosts, ordered by first appearance in the timeline. This
		// is recomputed whenever a single leg is focused, so focusing collapses the diagram down
		// to just the hosts that leg actually touched.
		callLogsSipFlowActors: function(messages) {
			var self = this,
				actors = [];

			_.each(messages, function(msg) {
				_.each([ self.callLogsSipFlowHost(msg.src), self.callLogsSipFlowHost(msg.dst) ], function(host) {
					if (!_.includes(actors, host)) {
						actors.push(host);
					}
				});
			});

			return actors;
		},

		// rawText is the combined SIP trace for every leg (as returned by the SIP server). It is
		// parsed into messages, grouped into per-leg flows by Call-ID, then merged into one model.
		//
		// The diagram is drawn as three SVG panes sharing one geometry: a frozen header strip
		// (the hosts), a frozen left gutter (the timestamps) and the scrolling ladder itself. The
		// strip and the gutter are scroll-synced to the ladder, so on a long or wide trace the
		// column headings and the times stay on screen instead of scrolling away.
		callLogsRenderSipFlow: function(rawText, callSummary) {
			var self = this,
				parsed = self.callLogsParseSipFlow(rawText),
				flows = self.callLogsGroupSipFlowLegs(parsed.messages),
				model = self.callLogsMergeSipFlows(flows);

			if (_.isEmpty(model.messages)) {
				monster.ui.alert('error', self.i18n.active().callLogs.sipFlow.noData);
				return;
			}

			var template = $(self.getTemplate({
					name: 'sipFlow',
					submodule: 'callLogs'
				})),
				$body = template.find('.sip-flow-body'),
				$legend = template.find('.sip-flow-legend'),
				$detail = template.find('.sip-flow-detail'),
				$detailMeta = template.find('.sip-flow-detail-meta'),
				stripNode = template.find('.sip-flow-actorstrip')[0],
				gutterNode = template.find('.sip-flow-gutter')[0],
				canvasNode = template.find('.sip-flow-canvas')[0],
				// Several flows can be open at once, so namespace the global handlers per dialog.
				eventNamespace = '.sipFlow' + _.uniqueId(),
				// The two scopes the diagram can be narrowed by. They are mutually exclusive:
				// picking one clears the other, so there is only ever one filter to reason about.
				// null = every leg is shown; otherwise the index of the leg being focused.
				focusedLeg = null,
				// A host: shows every leg that passes through it.
				focusedHost = null,
				// The leg being previewed on hover: false when not previewing, so that null
				// stays available to mean "preview all legs".
				previewLeg = false,
				pendingPreview = null,
				scrollBeforePreview = 0,
				isOverflowOpen = false,
				selectedIndex = null,
				selectedRaw = '',
				layout = null;

			function visibleMessages() {
				var isPreviewing = previewLeg !== false,
					leg = isPreviewing ? previewLeg : focusedLeg,
					legsThroughHost;

				if (!_.isNull(leg)) {
					return _.filter(model.messages, { legIndex: leg });
				}

				// A leg preview takes precedence: hovering a leg while a host is scoped shows
				// that leg alone, and leaving drops back to the host.
				if (!isPreviewing && !_.isNull(focusedHost)) {
					legsThroughHost = self.callLogsSipFlowLegsForHost(model, focusedHost);

					return _.filter(model.messages, function(msg) {
						return _.includes(legsThroughHost, msg.legIndex);
					});
				}

				return model.messages;
			}

			// Keep the frozen panes lined up with the ladder.
			function syncPanes() {
				stripNode.scrollLeft = canvasNode.scrollLeft;
				gutterNode.scrollTop = canvasNode.scrollTop;
			}

			function eachPane(callback) {
				_.each([ canvasNode, gutterNode ], callback);
			}

			function applySelection() {
				eachPane(function(pane) {
					_.each(pane.querySelectorAll('.selected'), function(node) {
						self.callLogsSipFlowToggleClass(node, 'selected', false);
					});
				});

				if (_.isNull(selectedIndex)) {
					return;
				}

				eachPane(function(pane) {
					_.each(pane.querySelectorAll('[data-index="' + selectedIndex + '"]'), function(node) {
						self.callLogsSipFlowToggleClass(node, 'selected', true);
					});
				});
			}

			// Hovering a leg previews it by filtering the others out, rather than dimming them in
			// place. Dimming only ever helped for a leg that was already on screen: you cannot
			// scroll while hovering, so anything below the fold stayed invisible. Filtering
			// re-lays the leg out from the top, where it can actually be read.
			function startPreview(legIndex) {
				cancelPendingPreview();

				// Already what is on screen.
				if (legIndex === focusedLeg && previewLeg === false) {
					return;
				}

				// A short delay so sweeping the pointer across the legend does not strobe the
				// diagram; only a deliberate hover previews.
				pendingPreview = setTimeout(function() {
					pendingPreview = null;

					if (previewLeg === false) {
						scrollBeforePreview = canvasNode.scrollTop;
					}

					previewLeg = legIndex;
					canvasNode.scrollTop = 0;
					renderDiagram();
				}, 140);
			}

			function endPreview() {
				cancelPendingPreview();

				if (previewLeg === false) {
					return;
				}

				previewLeg = false;
				renderDiagram();
				// Put the reader back where they were, so an accidental hover costs nothing.
				canvasNode.scrollTop = scrollBeforePreview;
				syncPanes();
			}

			function cancelPendingPreview() {
				if (pendingPreview) {
					clearTimeout(pendingPreview);
					pendingPreview = null;
				}
			}

			// Note: jQuery 1.9.1 cannot reliably add/remove classes or delegate selectors on SVG
			// nodes (className is an SVGAnimatedString), so the rows are wired with native DOM.
			function wireRow(node) {
				node.addEventListener('click', function() {
					selectMessage(parseInt(node.getAttribute('data-index'), 10));
				});
			}

			function renderDiagram() {
				var messages = visibleMessages(),
					// The canvas always reserves its vertical scrollbar, so clientWidth does not
					// change between renders (which would make the fit-to-width sizing oscillate).
					available = canvasNode.clientWidth
						|| (Math.min($(window).width() * 0.94, 1600) - 130);

				layout = self.callLogsSipFlowLayout(self.callLogsSipFlowActors(messages), messages, available);

				stripNode.innerHTML = self.callLogsBuildSipFlowActorsSvg(layout);
				gutterNode.innerHTML = self.callLogsBuildSipFlowGutterSvg(layout);
				canvasNode.innerHTML = self.callLogsBuildSipFlowLadderSvg(layout);

				// Stop the header strip over-hanging the canvas' scrollbar.
				stripNode.style.marginRight = Math.max(canvasNode.offsetWidth - canvasNode.clientWidth, 0) + 'px';

				// Keep the frozen panes exactly as wide as the gutter they hold, so the times
				// stay lined up with the rows whatever the CSS default is.
				gutterNode.style.width = layout.gutterWidth + 'px';
				template.find('.sip-flow-corner').width(layout.gutterWidth);

				_.each(canvasNode.querySelectorAll('.sip-flow-msg'), wireRow);
				_.each(gutterNode.querySelectorAll('.sip-flow-gutter-row'), wireRow);

				_.each(stripNode.querySelectorAll('.sip-flow-actor'), function(node) {
					var host = node.getAttribute('data-host');

					self.callLogsSipFlowToggleClass(node, 'active', host === focusedHost);
					node.addEventListener('click', function() {
						focusHost(host);
					});
				});

				applySelection();
				syncPanes();
			}

			function scrollRowIntoView(index) {
				var position = _.findIndex(visibleMessages(), { index: index }),
					rowTop, viewTop;

				if (position < 0 || _.isNull(layout)) {
					return;
				}

				rowTop = layout.topPad + position * layout.rowHeight;
				viewTop = canvasNode.scrollTop;

				if (rowTop < viewTop) {
					canvasNode.scrollTop = Math.max(rowTop - layout.rowHeight, 0);
				} else if (rowTop + layout.rowHeight > viewTop + canvasNode.clientHeight) {
					canvasNode.scrollTop = rowTop + 2 * layout.rowHeight - canvasNode.clientHeight;
				}

				syncPanes();
			}

			function selectMessage(index) {
				var msg = model.messages[index];

				if (!msg) {
					return;
				}

				selectedIndex = index;
				selectedRaw = msg.raw;
				$detailMeta.html(self.callLogsBuildSipFlowDetailMeta(msg));
				$detail.html(self.callLogsFormatSipMessage(msg.raw));

				if ($body.hasClass('detail-hidden')) {
					// Opening the pane narrows the ladder, so it has to be laid out again.
					$body.removeClass('detail-hidden');
					renderDiagram();
				}

				applySelection();
				scrollRowIntoView(index);
			}

			function closeDetail() {
				if ($body.hasClass('detail-hidden')) {
					return;
				}
				$body.addClass('detail-hidden');
				selectedIndex = null;
				renderDiagram();
			}

			// Focusing a leg filters the ladder down to that leg's messages, which also drops
			// every column the leg never talked to - usually the difference between a diagram
			// that scrolls sideways and one that fits.
			// Rebuilt whenever the leg labels or the visible set change; the click/hover handlers
			// are delegated from $legend, so they survive the markup being replaced.
			function renderLegend() {
				$legend.html(self.callLogsBuildSipFlowLegend(model, focusedLeg, focusedHost));
				markActiveLeg();
				setOverflowOpen(isOverflowOpen);
			}

			// Marks both the inline chip and its row in the overflow list, which share a data-leg.
			function markActiveLeg() {
				$legend.find('[data-leg]').removeClass('active');

				// Under a host scope neither a leg nor "all legs" is what is on screen; the host
				// chip carries the active state instead.
				if (_.isNull(focusedLeg) && !_.isNull(focusedHost)) {
					return;
				}

				$legend
					.find('[data-leg="' + (_.isNull(focusedLeg) ? 'all' : focusedLeg) + '"]')
					.addClass('active');
			}

			function setOverflowOpen(isOpen) {
				isOverflowOpen = isOpen && $legend.find('.sip-flow-legend-more-wrap').length > 0;
				$legend.find('.sip-flow-legend-more-wrap').toggleClass('open', isOverflowOpen);
			}

			// Redraw after a scope change. A full legend rebuild, not just a class toggle: pinning
			// a leg from the overflow list has to pull it into the inline chips, and the host
			// chip appears and disappears with the host scope.
			function applyScope() {
				var visible;

				renderLegend();
				canvasNode.scrollTop = 0;
				canvasNode.scrollLeft = 0;
				renderDiagram();

				// Keep the detail pane showing something that is actually on screen.
				visible = visibleMessages();
				if (!$body.hasClass('detail-hidden') && !_.some(visible, { index: selectedIndex })) {
					selectMessage(_.get(visible, '[0].index'));
				}
			}

			function focusLeg(legIndex) {
				// Clicking pins whatever is being previewed, so the preview is spent, not undone.
				cancelPendingPreview();
				previewLeg = false;
				focusedHost = null;
				focusedLeg = legIndex;
				applyScope();
			}

			// Scoping to a host shows every leg that passes through it - the question a column
			// header invites, which is "what went via this box?".
			function focusHost(host) {
				cancelPendingPreview();
				previewLeg = false;
				focusedLeg = null;
				// Clicking the scoped host again widens back out, as with the leg chips.
				focusedHost = focusedHost === host ? null : host;
				applyScope();
			}

			template.find('.sip-flow-summary').html(self.callLogsBuildSipFlowSummary(callSummary));
			renderLegend();

			// Selectors are on [data-leg] rather than the chip class, so the overflow list rows
			// pick up the same click, pin/unpin and hover-preview behaviour for free.
			$legend.on('click', '[data-leg]', function() {
				var leg = $(this).data('leg'),
					legIndex = leg === 'all' ? null : parseInt(leg, 10);

				setOverflowOpen(false);

				// Clicking the leg that is already pinned clears the filter: the chip that turned
				// the filter on is the obvious thing to reach for to turn it off again.
				focusLeg(legIndex === focusedLeg ? null : legIndex);
			});

			$legend.on('mouseenter', '[data-leg]', function() {
				var leg = $(this).data('leg');
				startPreview(leg === 'all' ? null : parseInt(leg, 10));
			});

			$legend.on('mouseleave', '[data-leg]', endPreview);

			$legend.on('click', '.sip-flow-legend-more', function() {
				setOverflowOpen(!isOverflowOpen);
			});

			$legend.on('click', '[data-host-clear]', function() {
				focusHost(focusedHost);
			});

			// Backstop: if the legend is rebuilt (device names arriving) while a chip is hovered,
			// that chip's mouseleave never fires, so leaving the legend as a whole ends it too.
			$legend.on('mouseleave', endPreview);

			template.find('.sip-flow-detail-close').on('click', closeDetail);

			monster.ui.clipboard(template.find('.sip-flow-detail-copy'), function() {
				return selectedRaw;
			}, self.i18n.active().callLogs.sipFlow.copied);

			canvasNode.addEventListener('scroll', syncPanes);

			// Keep the popup focused so Escape reaches it before the dialog's own handler.
			template.on('mousedown', function() {
				template.focus();
			});

			template.on('keydown', function(e) {
				if (e.which !== 27) {
					return;
				}

				// Escape unwinds one layer at a time: the overflow list, then the detail pane,
				// then (left to the dialog's own handler) the popup itself.
				if (isOverflowOpen) {
					e.stopPropagation();
					setOverflowOpen(false);
				} else if (!$body.hasClass('detail-hidden')) {
					e.stopPropagation();
					closeDetail();
				}
			});

			// Anywhere outside the overflow list dismisses it.
			$(document).on('click' + eventNamespace, function(e) {
				if (isOverflowOpen && !$(e.target).closest('.sip-flow-legend-more-wrap').length) {
					setOverflowOpen(false);
				}
			});

			// Step through messages with the arrow keys, skipping anything the leg filter hides.
			$(document).on('keydown' + eventNamespace, function(e) {
				var visible, position;

				if (e.which !== 38 && e.which !== 40) {
					return;
				}

				visible = visibleMessages();
				position = _.findIndex(visible, { index: selectedIndex }) + (e.which === 38 ? -1 : 1);

				if (position < 0 || position >= visible.length) {
					return;
				}

				e.preventDefault();
				selectMessage(visible[position].index);
			});

			monster.ui.dialog(template, {
				title: self.i18n.active().callLogs.sipFlow.title,
				dialogType: 'classic',
				autoScroll: false,
				onClose: function() {
					cancelPendingPreview();
					$(document).off('keydown' + eventNamespace);
					$(document).off('click' + eventNamespace);
					$(window).off('resize' + eventNamespace);
				}
			});

			// monster.ui.dialog returns once the popup is in the DOM and sized, so the ladder can
			// now be laid out against the pane's real width.
			renderDiagram();
			template.focus();

			$(window).on('resize' + eventNamespace, _.debounce(renderDiagram, 150));

			// The device names are cosmetic and the trace is already in hand, so the popup opens
			// on the raw SIP usernames and the legend is refreshed in place once they arrive.
			self.callLogsGetSipFlowDeviceNames(self.callLogsSipFlowLegEndpoints(model), function(namesByUsername) {
				if (_.isEmpty(namesByUsername)) {
					return;
				}

				_.each(model.legs, function(leg) {
					// Array paths: SIP usernames routinely contain dots.
					leg.fromName = _.get(namesByUsername, [ leg.from ]);
					leg.toName = _.get(namesByUsername, [ leg.to ]);
				});

				renderLegend();
			});
		},

		// Call-level summary shown above the diagram, built from the CDR diagnostic data.
		callLogsBuildSipFlowSummary: function(summary) {
			var self = this,
				i18n = self.i18n.active().callLogs.sipFlow;

			if (!summary || _.isEmpty(summary)) {
				return '';
			}

			var from = summary.from_number || summary.from_name || '',
				to = summary.to_number || summary.to_name || '',
				fields = [];

			fields.push('<span class="sip-flow-summary-call"><b>' + self.callLogsSipFlowEscape(from)
				+ '</b> <span class="sip-flow-summary-arrow">&#8594;</span> <b>' + self.callLogsSipFlowEscape(to) + '</b></span>');

			_.each([
				{ label: i18n.duration, value: summary.duration },
				{ label: i18n.hangup, value: summary.hangup_cause },
				{ label: i18n.date, value: summary.date }
			], function(field) {
				if (field.value) {
					fields.push('<span><span class="sip-flow-summary-label">' + self.callLogsSipFlowEscape(field.label)
						+ ':</span> ' + self.callLogsSipFlowEscape(field.value) + '</span>');
				}
			});

			return fields.join('');
		},

		// How many leg chips sit inline before the rest fold into the overflow list. Set through
		// sipFlowVisibleLegs in the app's miscSettings, so it can be tuned from the config doc
		// rather than in code.
		callLogsSipFlowLegLimit: function() {
			var limit = parseInt(_.get(miscSettings, 'sipFlowVisibleLegs'), 10);

			return _.isFinite(limit) && limit > 0 ? limit : 10;
		},

		// The legs shown inline. A pinned leg is always among them even when it sorts past the
		// limit, so the filter in force is never hidden away inside the overflow list.
		callLogsSipFlowVisibleLegs: function(model, focusedLeg) {
			var limit = this.callLogsSipFlowLegLimit(),
				visible = _.take(model.legs, limit);

			if (!_.isNull(focusedLeg) && !_.some(visible, { index: focusedLeg })) {
				visible = _
					.take(visible, Math.max(limit - 1, 0))
					.concat(_.filter(model.legs, { index: focusedLeg }));
			}

			return visible;
		},

		// Swatch, label and counts, shared by the inline chips and the overflow list rows.
		callLogsBuildSipFlowLegContent: function(leg) {
			var self = this,
				i18n = self.i18n.active().callLogs.sipFlow,
				outcome = leg.outcome ? (leg.outcome.statusCode + ' ' + leg.outcome.reason) : '',
				meta = leg.count + ' ' + i18n.messageCount + (outcome ? ' · ' + outcome : '');

			return '<i class="sip-flow-swatch" style="background:' + leg.color + '"></i>'
				+ '<span class="sip-flow-legend-label">'
				+ self.callLogsSipFlowEscape(self.callLogsSipFlowLegLabel(leg)) + '</span>'
				+ '<span class="sip-flow-legend-meta">' + self.callLogsSipFlowEscape(meta) + '</span>';
		},

		// Per-leg legend. Each entry doubles as a filter: clicking it focuses that leg. Colours
		// come from a fixed palette, so they are safe to inline as styles.
		callLogsBuildSipFlowLegend: function(model, focusedLeg, focusedHost) {
			var self = this,
				i18n = self.i18n.active().callLogs.sipFlow,
				// "All legs" carries a miniature of every leg colour instead of a single swatch.
				allSwatch = _
					.chain(model.legs)
					.map('color')
					.take(4)
					.map(function(color) { return '<span style="background:' + color + '"></span>'; })
					.join('')
					.value(),
				items = [
					'<span class="sip-flow-legend-item sip-flow-legend-all" data-leg="all">'
						+ '<i class="sip-flow-swatch sip-flow-swatch-all">' + allSwatch + '</i>'
						+ '<span class="sip-flow-legend-label">' + self.callLogsSipFlowEscape(i18n.allLegs) + '</span>'
						+ '<span class="sip-flow-legend-meta">' + model.legs.length + ' '
						+ self.callLogsSipFlowEscape(i18n.legCount) + ' · ' + model.messages.length + ' '
						+ self.callLogsSipFlowEscape(i18n.messageCount) + '</span>'
						+ '</span>'
				];

			// A host scope is not one of the legs, so it gets its own chip stating what is being
			// filtered and offering the way out.
			if (!_.isNil(focusedHost)) {
				var hostLegs = self.callLogsSipFlowLegsForHost(model, focusedHost),
					hostName = self.callLogsSipFlowHostName(focusedHost),
					hostCount = _.filter(model.messages, function(msg) {
						return _.includes(hostLegs, msg.legIndex);
					}).length;

				items.push('<span class="sip-flow-legend-item sip-flow-legend-host active" data-host-clear="1"'
					+ ' title="' + self.callLogsSipFlowEscape(focusedHost) + '">'
					+ '<span class="sip-flow-legend-label">' + self.callLogsSipFlowEscape(i18n.hostScope)
					+ ' ' + self.callLogsSipFlowEscape(hostName || focusedHost) + '</span>'
					+ '<span class="sip-flow-legend-meta">' + hostLegs.length + ' '
					+ self.callLogsSipFlowEscape(i18n.legCount) + ' · ' + hostCount + ' '
					+ self.callLogsSipFlowEscape(i18n.messageCount) + '</span>'
					+ '<span class="sip-flow-legend-clear">&times;</span>'
					+ '</span>');
			}

			var visibleLegs = self.callLogsSipFlowVisibleLegs(model, focusedLeg),
				hiddenCount = model.legs.length - visibleLegs.length;

			// Device names replace the SIP usernames on screen; the tooltip keeps the underlying
			// SIP identities, which is what a trace is usually read against.
			function legAttributes(leg) {
				return ' data-leg="' + leg.index + '" style="--leg-color:' + leg.color + '"'
					+ ' title="' + self.callLogsSipFlowEscape(leg.from + ' → ' + leg.to) + '"';
			}

			// The pinned leg carries the same clear control as the host chip: both are filters in
			// force, so both offer the same way out, even though a click anywhere on the chip clears.
			_.each(visibleLegs, function(leg) {
				items.push('<span class="sip-flow-legend-item"' + legAttributes(leg) + '>'
					+ self.callLogsBuildSipFlowLegContent(leg)
					+ (leg.index === focusedLeg ? '<span class="sip-flow-legend-clear">&times;</span>' : '')
					+ '</span>');
			});

			if (hiddenCount > 0) {
				// The panel lists every leg, not just the hidden ones, so it works as the full
				// index: you can move between any two legs without closing and reopening it.
				items.push('<span class="sip-flow-legend-more-wrap">'
					+ '<span class="sip-flow-legend-item sip-flow-legend-more">+' + hiddenCount + ' '
					+ self.callLogsSipFlowEscape(i18n.moreLegs) + '</span>'
					+ '<div class="sip-flow-legend-overflow">'
					+ '<div class="sip-flow-legend-overflow-title">'
					+ self.callLogsSipFlowEscape(i18n.allLegs) + ' (' + model.legs.length + ')</div>'
					+ _.map(model.legs, function(leg) {
						return '<span class="sip-flow-leg-row"' + legAttributes(leg) + '>'
							+ self.callLogsBuildSipFlowLegContent(leg) + '</span>';
					}).join('')
					+ '</div></span>');
			}

			return items.join('');
		},

		// A leg reads "<from> -> <to>", preferring the device name over the raw SIP username
		// wherever the device lookup resolved one.
		callLogsSipFlowLegLabel: function(leg) {
			return (leg.fromName || leg.from) + ' → ' + (leg.toName || leg.to);
		},

		// Every distinct SIP identity appearing at either end of a leg. Carrier numbers are
		// included: they simply will not match a device, and a device with a numeric SIP
		// username should still resolve.
		callLogsSipFlowLegEndpoints: function(model) {
			return _
				.chain(model.legs)
				.flatMap(function(leg) { return [ leg.from, leg.to ]; })
				.compact()
				.uniq()
				.value();
		},

		// Resolve SIP usernames to their device names, so the legend reads "(UCB) Matt Forrest"
		// rather than "user_9EvwES6byB". Returns a username -> name map; anything that is not a
		// device is absent from it and keeps its raw value.
		callLogsGetSipFlowDeviceNames: function(usernames, callback) {
			var self = this;

			if (_.isEmpty(usernames)) {
				return callback({});
			}

			self.callApi({
				resource: 'device.list',
				data: {
					accountId: self.accountId,
					// Names are a nicety: never let a failed lookup raise an error over the flow.
					generateError: false,
					filters: {
						// The SDK only JSON-encodes array values for a handful of filter
						// prefixes, and filter_sip.username is not one of them, so the list is
						// stringified here to produce filter_sip.username=["a","b"].
						'filter_sip.username': JSON.stringify(usernames),
						paginate: false
					}
				},
				success: function(data) {
					callback(_
						.chain(data.data)
						.filter(function(device) { return device.username && device.name; })
						.keyBy('username')
						.mapValues('name')
						.value());
				},
				error: function() {
					callback({});
				}
			});
		},

		// Geometry shared by the three panes. Columns are spread to fill the available width;
		// only when there are too many hosts to fit do they fall back to a minimum gap and let
		// the ladder scroll horizontally.
		callLogsSipFlowLayout: function(actors, messages, availableWidth) {
			var minColGap = 110,
				maxColGap = 320,
				maxBoxWidth = 148,
				// Wide enough for "10:19:13.465" at 12px plus the offset line beneath it.
				gutterWidth = 116,
				rowHeight = 46,
				topPad = 10,
				bottomPad = 24,
				headerTop = 8,
				headerHeight = 40,
				spans = Math.max(actors.length - 1, 0),
				usableWidth = Math.max(availableWidth, 240),
				// The end columns are centred on their lifelines, so the ladder needs half a box
				// of margin at each end. Budget for the widest box up front: the real box can
				// only end up narrower, which leaves slack for offsetX to centre rather than
				// overflow.
				maxSidePad = Math.round(maxBoxWidth / 2) + 8,
				colGap = _.clamp((usableWidth - 2 * maxSidePad) / Math.max(spans, 1), minColGap, maxColGap),
				boxWidth = Math.min(maxBoxWidth, colGap - 10),
				sidePad = Math.round(boxWidth / 2) + 8,
				contentWidth = sidePad * 2 + spans * colGap,
				// Centre a ladder that is narrower than its pane instead of leaving all of the
				// slack on the right.
				offsetX = Math.max(0, (usableWidth - contentWidth) / 2);

			return {
				actors: actors,
				messages: messages,
				colGap: colGap,
				boxWidth: boxWidth,
				gutterWidth: gutterWidth,
				rowHeight: rowHeight,
				topPad: topPad,
				bottomPad: bottomPad,
				headerTop: headerTop,
				headerHeight: headerHeight,
				stripHeight: headerTop + headerHeight + 8,
				width: Math.max(contentWidth, usableWidth),
				height: topPad + messages.length * rowHeight + bottomPad,
				firstTs: Date.parse(_.get(messages, '[0].timestamp')),
				actorX: function(host) {
					return offsetX + sidePad + _.indexOf(actors, host) * colGap;
				}
			};
		},

		// Frozen header strip: one box per host, plus the top of each lifeline. Where a host is
		// named in the platform map the name leads and the IP drops to a smaller second line;
		// unnamed hosts keep the IP on its own, vertically centred.
		//
		// Each host is wrapped in a <g> so that clicking anywhere on the box - including its
		// text - scopes the diagram to the legs passing through that host.
		callLogsBuildSipFlowActorsSvg: function(layout) {
			var self = this,
				parts = [ self.callLogsSipFlowSvgOpen(layout.width, layout.stripHeight) ];

			_.each(layout.actors, function(host) {
				var x = layout.actorX(host),
					name = self.callLogsSipFlowHostName(host),
					maxTextWidth = layout.boxWidth - 12,
					title = '<title>' + self.callLogsSipFlowEscape(name ? name + ' (' + host + ')' : host) + '</title>';

				parts.push('<g class="sip-flow-actor" data-host="' + self.callLogsSipFlowEscape(host) + '">');
				parts.push('<rect class="sip-flow-actor-box" x="' + (x - layout.boxWidth / 2) + '" y="' + layout.headerTop
					+ '" width="' + layout.boxWidth + '" height="' + layout.headerHeight + '" rx="4">' + title + '</rect>');

				if (name) {
					parts.push('<text class="sip-flow-actor-name" x="' + x + '" y="' + (layout.headerTop + 18)
						+ '" text-anchor="middle">'
						+ self.callLogsSipFlowEscape(self.callLogsSipFlowTruncate(name, maxTextWidth, 6.4)) + title + '</text>');
					parts.push('<text class="sip-flow-actor-ip sip-flow-actor-sub" x="' + x + '" y="' + (layout.headerTop + 31)
						+ '" text-anchor="middle">'
						+ self.callLogsSipFlowEscape(self.callLogsSipFlowFitHost(host, maxTextWidth, 5.6)) + title + '</text>');
				} else {
					parts.push('<text class="sip-flow-actor-ip" x="' + x + '" y="' + (layout.headerTop + 25)
						+ '" text-anchor="middle">'
						+ self.callLogsSipFlowEscape(self.callLogsSipFlowFitHost(host, maxTextWidth)) + title + '</text>');
				}

				parts.push('<line class="sip-flow-lifeline" x1="' + x + '" y1="' + (layout.headerTop + layout.headerHeight)
					+ '" x2="' + x + '" y2="' + layout.stripHeight + '" />');
				parts.push('</g>');
			});

			parts.push('</svg>');

			return parts.join('');
		},

		// Indexes of every leg that passes through the given host, in leg order.
		callLogsSipFlowLegsForHost: function(model, host) {
			var self = this;

			return _
				.chain(model.messages)
				.filter(function(msg) {
					return self.callLogsSipFlowHost(msg.src) === host
						|| self.callLogsSipFlowHost(msg.dst) === host;
				})
				.map('legIndex')
				.uniq()
				.sortBy()
				.value();
		},

		// Friendly name for a platform host, from the sipFlowPlatformNames map in the app's
		// miscSettings (config.js). Keys are IPs, so the path has to be passed as an array or
		// lodash reads the dots as nesting.
		callLogsSipFlowHostName: function(host) {
			var name = _.get(miscSettings, [ 'sipFlowPlatformNames', host ]);

			return _.isString(name) && $.trim(name) !== '' ? $.trim(name) : '';
		},

		// Frozen left gutter: absolute time, offset from the first message, transport, and a
		// colour tick so a row can be traced back to its leg without reading the arrow colours.
		callLogsBuildSipFlowGutterSvg: function(layout) {
			var self = this,
				width = layout.gutterWidth,
				parts = [ self.callLogsSipFlowSvgOpen(width, layout.height) ];

			_.each(layout.messages, function(msg, i) {
				var rowTop = layout.topPad + i * layout.rowHeight,
					y = rowTop + layout.rowHeight / 2;

				parts.push('<g class="sip-flow-gutter-row' + (i % 2 ? ' alt' : '') + '" data-index="' + msg.index
					+ '" data-leg="' + msg.legIndex + '">');
				parts.push('<rect class="sip-flow-row" x="0" y="' + rowTop + '" width="' + width
					+ '" height="' + layout.rowHeight + '" />');
				parts.push('<rect class="sip-flow-legtick" x="0" y="' + (rowTop + 8) + '" width="3" height="'
					+ (layout.rowHeight - 16) + '" fill="' + (msg.legColor || '#22a5ff') + '" />');
				parts.push('<text class="sip-flow-time" x="12" y="' + (y - 3) + '">'
					+ self.callLogsSipFlowEscape(self.callLogsSipFlowTime(msg.timestamp)) + '</text>');
				parts.push('<text class="sip-flow-reltime" x="12" y="' + (y + 11) + '">'
					+ self.callLogsSipFlowEscape(self.callLogsSipFlowOffset(msg, layout.firstTs) + ' · ' + msg.protocol)
					+ '</text>');
				parts.push('</g>');
			});

			parts.push('</svg>');

			return parts.join('');
		},

		// The ladder itself: lifelines, then one <g> per message. Grouping the row's hit area
		// with its arrow and label means a click anywhere on the row - including directly on the
		// arrow - selects the message.
		callLogsBuildSipFlowLadderSvg: function(layout) {
			var self = this,
				lifelineBottom = layout.height - layout.bottomPad + 8,
				parts = [ self.callLogsSipFlowSvgOpen(layout.width, layout.height) ];

			_.each(layout.actors, function(host) {
				var x = layout.actorX(host);
				parts.push('<line class="sip-flow-lifeline" x1="' + x + '" y1="0" x2="' + x + '" y2="' + lifelineBottom + '" />');
			});

			_.each(layout.messages, function(msg, i) {
				var rowTop = layout.topPad + i * layout.rowHeight,
					y = rowTop + layout.rowHeight / 2,
					x1 = layout.actorX(self.callLogsSipFlowHost(msg.src)),
					x2 = layout.actorX(self.callLogsSipFlowHost(msg.dst)),
					isLoop = x1 === x2,
					color = msg.legColor || '#22a5ff',
					dir = x2 >= x1 ? 1 : -1,
					dash = msg.type === 'response' ? ' stroke-dasharray="5 3"' : '',
					// Trim the label to the span it sits on so it never runs over a neighbouring
					// lifeline; the row's <title> keeps the full text one hover away.
					label = self.callLogsSipFlowTruncate(msg.label, isLoop ? layout.colGap - 40 : Math.abs(x2 - x1) - 16, 6.2);

				parts.push('<g class="sip-flow-msg' + (i % 2 ? ' alt' : '') + '" data-index="' + msg.index
					+ '" data-leg="' + msg.legIndex + '">');
				parts.push('<rect class="sip-flow-row" x="0" y="' + rowTop + '" width="' + layout.width
					+ '" height="' + layout.rowHeight + '"><title>' + self.callLogsSipFlowEscape(msg.label) + '</title></rect>');

				if (isLoop) {
					// Same host on both ends (rare) - draw a small loop.
					parts.push('<path class="sip-flow-arrow" stroke="' + color + '"' + dash + ' fill="none" d="M'
						+ x1 + ',' + (y - 8) + ' h24 v16 h-24" />');
					parts.push(self.callLogsSipFlowArrowHead(x1, y + 8, -1, color));
				} else {
					parts.push('<line class="sip-flow-arrow" stroke="' + color + '"' + dash + ' x1="' + x1 + '" y1="' + y
						+ '" x2="' + (x2 - dir * 7) + '" y2="' + y + '" />');
					parts.push(self.callLogsSipFlowArrowHead(x2, y, dir, color));
				}

				parts.push('<text class="sip-flow-label" x="' + (isLoop ? x1 + 32 : (x1 + x2) / 2) + '" y="' + (y - 8)
					+ '" text-anchor="middle" fill="' + color + '">' + self.callLogsSipFlowEscape(label) + '</text>');
				parts.push('</g>');
			});

			parts.push('</svg>');

			return parts.join('');
		},

		// Header of the detail pane: leg colour, time and the endpoints the message travelled
		// between (with ports, which the ladder's host columns drop).
		callLogsBuildSipFlowDetailMeta: function(msg) {
			var self = this;

			return '<span class="sip-flow-detail-chip" style="background:' + (msg.legColor || '#22a5ff') + '"></span>'
				+ '<span>' + self.callLogsSipFlowEscape(self.callLogsSipFlowTime(msg.timestamp) + ' · ' + msg.protocol) + '</span>'
				+ '<span class="sip-flow-detail-route">' + self.callLogsSipFlowEscape(msg.src)
				+ ' &#8594; ' + self.callLogsSipFlowEscape(msg.dst) + '</span>';
		},

		// Escape a raw SIP message and mark up its start line, header names and body so the pane
		// can be skimmed. Everything is escaped on the way through.
		callLogsFormatSipMessage: function(raw) {
			var self = this,
				seenStartLine = false,
				inBody = false;

			return _
				.map(String(_.isNil(raw) ? '' : raw).split(/\r?\n/), function(line) {
					var escaped = self.callLogsSipFlowEscape(line),
						headerMatch;

					if (inBody) {
						return '<span class="sip-body-line">' + escaped + '</span>';
					}

					if ($.trim(line) === '') {
						// The blank line after the headers starts the body (SDP, and so on).
						inBody = seenStartLine;
						return escaped;
					}

					if (!seenStartLine) {
						seenStartLine = true;
						return '<span class="sip-start-line">' + escaped + '</span>';
					}

					headerMatch = line.match(/^([A-Za-z0-9\-\.]+):([\s\S]*)$/);

					return headerMatch
						? '<span class="sip-header-name">' + self.callLogsSipFlowEscape(headerMatch[1]) + ':</span>'
							+ self.callLogsSipFlowEscape(headerMatch[2])
						: escaped;
				})
				.join('\n');
		},

		callLogsSipFlowSvgOpen: function(width, height) {
			return '<svg class="sip-flow-svg" width="' + width + '" height="' + height
				+ '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">';
		},

		callLogsSipFlowArrowHead: function(x, y, dir, color) {
			var d = dir >= 0 ? 1 : -1,
				back = x - d * 9;
			return '<path class="sip-flow-arrowhead" fill="' + color + '" d="M' + x + ',' + y
				+ ' L' + back + ',' + (y - 5)
				+ ' L' + back + ',' + (y + 5) + ' Z" />';
		},

		// Add/remove a class on an SVG node. Needed because jQuery 1.9.1's addClass/removeClass
		// assume className is a string, which it is not on SVG elements.
		callLogsSipFlowToggleClass: function(node, className, isOn) {
			var classes = _.without((node.getAttribute('class') || '').split(/\s+/), '', className);

			if (isOn) {
				classes.push(className);
			}

			node.setAttribute('class', classes.join(' '));
		},

		// Shrink a host label to fit its box: IPv4 addresses degrade to their last two octets
		// before falling back to a hard truncation. The full value stays in the <title>.
		callLogsSipFlowFitHost: function(host, maxWidth, pCharWidth) {
			var self = this,
				// Narrower glyphs when the IP is the smaller second line under a friendly name.
				charWidth = pCharWidth || 6.4,
				octets = String(host).split('.'),
				shortened;

			if (String(host).length * charWidth <= maxWidth) {
				return host;
			}

			if (octets.length === 4) {
				shortened = '…' + octets.slice(2).join('.');

				if (shortened.length * charWidth <= maxWidth) {
					return shortened;
				}
			}

			return self.callLogsSipFlowTruncate(host, maxWidth, charWidth);
		},

		// Rough proportional-font fit: SVG has no cheap way to measure text before it is drawn,
		// so approximate from an average glyph width.
		callLogsSipFlowTruncate: function(text, maxWidth, charWidth) {
			var value = String(_.isNil(text) ? '' : text),
				maxChars = Math.floor(maxWidth / charWidth);

			if (maxChars < 2) {
				return '';
			}

			return value.length <= maxChars ? value : value.substring(0, maxChars - 1) + '…';
		},

		// Extract the host portion from an "ip:port" endpoint, leaving bracketed IPv6 intact.
		callLogsSipFlowHost: function(endpoint) {
			var value = String(endpoint),
				bracketed = value.match(/^\[(.+)\]/);

			if (bracketed) {
				return bracketed[1];
			}

			// An unbracketed colon only separates the port when there is exactly one of them.
			return value.split(':').length === 2 ? value.split(':')[0] : value;
		},

		callLogsSipFlowEscape: function(value) {
			return String(_.isNil(value) ? '' : value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');
		},

		callLogsSipFlowTime: function(timestamp) {
			var match = String(timestamp).match(/T(\d{2}:\d{2}:\d{2})(\.\d+)?/);
			if (!match) {
				return timestamp;
			}
			return match[1] + (match[2] ? match[2].substring(0, 4) : '');
		},

		// Offset of a message from the start of the trace, e.g. "+15.915s".
		callLogsSipFlowOffset: function(msg, firstTs) {
			var seconds = (Date.parse(msg.timestamp) - firstTs) / 1000;

			if (!_.isFinite(seconds)) {
				return '';
			}

			return (seconds >= 0 ? '+' : '') + seconds.toFixed(3) + 's';
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

		// Fetch the combined SIP network trace (plain text) for one or more call-ids. The server
		// expects { call_id: [<bare call-ids>], timestamp: <ISO date> } and returns the trace as
		// text. Result is delivered via callback(err, rawText).
		getTextNetworkTrace: function(callIds, timestamp, callback) {
			var self = this,
				apiRoot = requestSettings.getTextNetworkTrace.apiRoot,
				url = requestSettings.getTextNetworkTrace.url,
				endpointUrl = apiRoot + url;

			monster.pub('monster.requestStart');

			fetch(endpointUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ call_id: callIds, timestamp: timestamp })
			})
			.then(function(response) {
				if (!response.ok) {
					throw new Error('Failed to fetch the network trace');
				}
				return response.text();
			})
			.then(function(rawText) {
				monster.pub('monster.requestEnd');
				callback && callback(null, rawText);
			})
			.catch(function(error) {
				monster.pub('monster.requestEnd');
				if (miscSettings.enableConsoleLogging) {
					console.log('getTextNetworkTrace error:', error);
				}
				callback && callback(error);
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

		},

		// local timepicker function that formats 24hr as 00:00 opposed to 0:00
		timepicker: function(target, pOptions) {
			var self = this,
				is12hMode = _.get(monster, 'apps.auth.currentUser.ui_flags.twelve_hours_mode', false),
				defaultOptions = {
					timeFormat: is12hMode ? 'g:i A' : 'H:i',
					lang: monster.apps.core.i18n.active().timepicker
				},
				options = $.extend(true, {}, defaultOptions, pOptions);

			return target.timepicker(options);
		}

	};

	return app;
});
