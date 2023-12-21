define(function(require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster');

	var appSubmodules = [
		'callLogs'
	];

	require(_.map(appSubmodules, function(name) {
		return './submodules/' + name + '/' + name;
	}));

	var app = {
		name: 'calllogs',

		css: [ 'app' ],

		i18n: {
			'de-DE': { customCss: false },
			'en-US': { customCss: false },
			'fr-FR': { customCss: false },
			'ru-RU': { customCss: false },
			'es-ES': { customCss: false },
			'fr-CA': { customCss: false }
		},

		requests: {},
		subscribe: {
			'core.crossSiteMessage.voip': 'crossSiteMessageHandler'
		},
		appFlags: {
			common: {
				hasProvisioner: false,
				outboundPrivacy: [
					'default',
					'none',
					'number',
					'name',
					'full'
				],
				callRecording: {
					supportedAudioFormats: [
						'mp3',
						'wav'
					],
					validationConfig: {
						rules: {
							time_limit: {
								digits: true,
								required: true
							},
							url: {
								protocols: [
									'http',
									'https',
									'ftp',
									'ftps',
									'sftp'
								],
								required: true
							}
						}
					}
				}
			},
			global: {},
			disableFirstUseWalkthrough: monster.config.whitelabel.disableFirstUseWalkthrough
		},

		subModules: appSubmodules,

		render: function(container) {
			var self = this,
				parent = container || $('#monster_content'),
				template = $(self.getTemplate({
					name: 'app'
				}));

			self.appFlags.common.hasProvisioner = _.isString(monster.config.api.provisioner);

			self.loadGlobalData(function() {
				/* On first Load, load call logs */
				template.find('.category#callLogs').addClass('active');
				monster.pub('voip.callLogs.render', { parent: template.find('.right-content') });
			});

			self.bindEvents(template);

			parent
				.empty()
				.append(template);
		},

		formatData: function(data) {
			var self = this;
		},

		isExtensionDisplayable: function(number) {
			var isAlphanumericExtensionsEnabled = monster.util.isFeatureAvailable('smartpbx.users.settings.utfExtensions.show'),
				regex = /\D/,
				isAlphanumericExtension = regex.test(number);

			return isAlphanumericExtensionsEnabled || !isAlphanumericExtension;
		},

		loadGlobalData: function(callback) {
			var self = this;

			monster.parallel({
				servicePlansRole: function(callback) {
					if (monster.config.hasOwnProperty('resellerId') && monster.config.resellerId.length) {
						self.callApi({
							resource: 'services.listAvailable',
							data: {
								accountId: self.accountId,
								filters: {
									paginate: false,
									'filter_merge.strategy': 'cumulative'
								}
							},
							success: function(data, status) {
								var formattedData = _.keyBy(data.data, 'id');

								callback(null, formattedData);
							}
						});
					} else {
						callback(null, {});
					}
				}
			}, function(err, results) {
				self.appFlags.global.servicePlansRole = results.servicePlansRole;
				self.appFlags.global.showUserTypes = !_.isEmpty(results.servicePlansRole);

				callback && callback(self.appFlags.global);
			});
		},

		bindEvents: function(parent) {
			var self = this,
				container = parent.find('.right-content');

			parent.find('.left-menu').on('click', '.category:not(.loading)', function() {
				// Get the ID of the submodule to render
				var $this = $(this),
					args = {
						parent: container,
						callback: function() {
							parent.find('.category').removeClass('loading');
						}
					},
					id = $this.attr('id');

				// Display the category we clicked as active
				parent
					.find('.category')
					.removeClass('active')
					.addClass('loading');
				$this.toggleClass('active');

				// Empty the main container and then render the submodule content
				container.empty();
				monster.pub('voip.' + id + '.render', args);
			});
		},

		crossSiteMessageHandler: function(topic) {
			var crossSiteMessageTopic = topic.replace('.tab', '') + '.render',
				container = $('.right-content');

			monster.pub(crossSiteMessageTopic, { parent: container });
		},

		overlayInsert: function() {
			$('#monster_content')
				.append($('<div>', {
					id: 'voip_container_overlay'
				}));
		},

		overlayRemove: function() {
			$('#monster_content')
				.find('#voip_container_overlay')
					.remove();
		}

		

		
		

		
	};

	return app;
});
