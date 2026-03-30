define(function(require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster'),
		miscSettings = {};

	var appSubmodules = [
		'callLogs'
	];

	require(_.map(appSubmodules, function(name) {
		return './submodules/' + name + '/' + name;
	}));

	var app = {
		name: 'dt-calllogs',

		css: [ 'app' ],

		i18n: {
			'de-DE': { customCss: false },
			'en-US': { customCss: false },
			'fr-FR': { customCss: false },
			'ru-RU': { customCss: false },
			'es-ES': { customCss: false }
		},

		requests: {},
		subscribe: {},
		appFlags: {},

		subModules: appSubmodules,

		load: function(callback) {
			var self = this;

			self.initApp(function() {
				callback && callback(self);
			});
		},

		initApp: function(callback) {
			var self = this;

			monster.pub('auth.initApp', {
				app: self,
				callback: callback
			});
		},

		render: function(container) {
			var self = this,
				parent = container || $('#monster_content'),
				template = $(self.getTemplate({
					name: 'app'
				}));


			monster.waterfall([

				function(callback) {

					// check whitelable doc for dimension configuration for app
					if (monster.config.whitelabel.hasOwnProperty('dimension')) {

						var data;
						data = monster.config.whitelabel;
						
						if (data.dimension.hasOwnProperty('dt_calllogs')) {

							if (data.dimension.dt_calllogs.hasOwnProperty('miscSettings')) {
								// support for original miscSettings format
								if (Array.isArray(data.dimension.dt_calllogs.miscSettings)) {
									data.dimension.dt_calllogs.miscSettings.forEach(function(action) {
										miscSettings[action] = true;
									});
								} else {
									miscSettings = data.dimension.dt_calllogs.miscSettings;
								}
							}
							
						}

						// log to console if enabled
						if (miscSettings.enableConsoleLogging) {
							console.log('miscSettings:', miscSettings);
						}

						callback()
					} else {
						callback()
					}
				},

				function() {
					monster.pub('callLogs.render', { miscSettings });
					parent
						.empty()
						.append(template);
				}
			]);
		},

	};

	return app;
});
