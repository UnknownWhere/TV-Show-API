var Show = require('../models/Show')
var eztv = require('./eztv')
var providers = [eztv];
var async = require('async')
var Trakt = require('trakt-api')
var trakt = new Trakt('f074b8fdb57b22e456a660cd97d259ef600b1942fc51b4b6e7d5a5850474129a')
var config = require('../config')
var URI = require('URIjs')

var TTL = config.scrapeTtl;

var helpers = {

	// resize image
	resizeImage: function(imageUrl, width) {
		var uri = URI(imageUrl),
			ext = uri.suffix(),
			file = uri.filename().split('.' + ext)[0];

		// Don't resize images that don't come from trakt
		//  eg. YTS Movie Covers
		if (uri.domain() !== 'trakt.us') {
			return imageUrl;
		}

		var existingIndex = 0;
		if ((existingIndex = file.search('-\\d\\d\\d$')) !== -1) {
			file = file.slice(0, existingIndex);
		}

		if (file === 'poster-dark') {
			return 'images/posterholder.png'.toString();
		} else {
			return uri.filename(file + '-' + width + '.' + ext).toString();
		}
	},

	// Source: http://stackoverflow.com/a/1714899/192024
	buildQuerystring: function(obj) {
		var str = []
		for (var p in obj)
			if (obj.hasOwnProperty(p))
				str.push(encodeURIComponent(p) + '=' + encodeURIComponent(obj[p]))
		return str.join('&')
	},

	// Source: http://phpjs.org/functions/preg_quote/
	preg_quote: function(str, delimiter) {
		return String(str)
			.replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]', 'g'), '\\$&');
	},

	// Determine if a given string matches a given pattern.
	// Inspired by PHP from Laravel 4.1
	str_is: function(pattern, value) {
		if (pattern == value) return true
		if (pattern == '*') return true

		pattern = this.preg_quote(pattern, '/')

		// Asterisks are translated into zero-or-more regular expression wildcards
		// to make it convenient to check if the strings starts with the given
		// pattern such as "library/*", making any string check convenient.
		var regex = new RegExp('^' + pattern.replace('\\*', '.*') + '$')

		return !!value.match(regex);
	},

	// Source: http://jamesroberts.name/blog/2010/02/22/string-functions-for-javascript-trim-to-camel-case-to-dashed-and-to-underscore/comment-page-1/
	stringToCamel: function(str) {
		return str.replace(/(\-[a-z])/g, function($1) {
			return $1.toUpperCase().replace('-', '')
		})
	},


	extractShowInfo: function(show, callback) {

		var that = this;
		console.log("extractShowInfo " + show.show + " " + show.imdb_id);
		var thisShow = {};
		var thisEpisodes = [];
		var thisEpisode = {};
		var numSeasons = 0;

		var imdb = show.imdb_id;

		eztv.getAllEpisodes(show, function(err, data) {
			thisShow = data;

			if (!data) return callback(null, show);
			if (!show.show) return callback(null, show);

			console.log("Looking for " + show.show);

			var dateBased = data.dateBased;
			delete data.dateBased;

			numSeasons = Object.keys(data).length; //Subtract dateBased key

			// upate with right torrent link
			if (!dateBased) {
				async.each(Object.keys(data), function(season, cb) {
						try {
							console.log("Get Season : " + imdb + " - " + season);
							trakt.season(imdb,season,{extended:'full,images'}, function(err, seasonData) {
								for (var episodeData in seasonData) {
									episodeData = seasonData[episodeData];
									//console.log(episodeData);
									if (typeof(data[season]) != 'undefined' && typeof(data[season][episodeData.number]) != 'undefined') {
										// hardcode the 720 for this source
										// TODO: Should add it from eztv_x
										thisEpisode = {
											tvdb_id: episodeData.ids.tvdb,
											season: episodeData.season,
											episode: episodeData.number,
											title: episodeData.title,
											image : episodeData.images.screenshot.medium,
											overview: episodeData.overview,
											date_based: false,
											first_aired: episodeData.first_aired,
											watched: {
												watched: false
											},
											torrents: []
										};
										thisEpisode.torrents = data[season][episodeData.number];
										thisEpisode.torrents[0] = data[season][episodeData.number]["480p"] ? data[season][episodeData.number]["480p"] : data[season][episodeData.number]["720p"]; // Prevents breaking the app
										console.log(thisEpisode);
										thisEpisodes.push(thisEpisode);
									}
								}
								cb();
							});
						} catch (err) {
							console.error("Error Get Episode:", err)
							return cb();
						}
					},
					function(err, res) {
						// Only change "lastUpdated" date if there are new episodes
						Show.find({
							imdb_id: imdb
						}, function(err, show) {
							if (err) return callback(err, null);
							if (show.episodes != thisEpisodes) {
								Show.update({
										imdb_id: imdb
									}, {
										$set: {
											episodes: thisEpisodes,
											last_updated: +new Date(),
											num_seasons: numSeasons
										}
									},
									function(err, show) {
										return callback(err, null);
									});
							} else {
								return callback(null, show);
							}
						});

					});
			} else {

				try {

					trakt.show(imdb,{extended:'full,images'}, function(err, show) {
						if (!show) return callback(null, show);
						else {
							var seasons = show.seasons;
							if(seasons == null || seasons.length == undefined) callback(null, show);
							async.each(seasons, function(season, cbs) {
								var episodes = season.episodes;
								console.log(episodes);
								async.each(episodes, function(episode, cbe) {
										var aired = episode.first_aired_iso;
										if (aired) {
											var year_aired = aired.substring(0, aired.indexOf("-"));
											var date_aired = aired.substring(aired.indexOf("-") + 1, aired.indexOf("T")).replace("-", "/");
											if (typeof(data[year_aired]) != 'undefined' && typeof(data[year_aired][date_aired]) != 'undefined') {
												thisEpisode = {
													tvdb_id: episode.ids.tvdb,
													season: episode.season,
													episode: episode.number,
													title: episode.title,
													overview: episode.overview,
													first_aired: episode.first_aired,
													image : episodeData.images.screenshot.medium,
													date_based: true,
													year: year_aired,
													day_aired: date_aired,
													watched: {
														watched: false
													},
													torrents: []
												};
												thisEpisode.torrents = data[year_aired][date_aired];
												thisEpisode.torrents[0] = data[year_aired][date_aired]["480p"] ? data[year_aired][date_aired]["480p"] : data[year_aired][date_aired]["720p"]; // Prevents breaking the app
												thisEpisodes.push(thisEpisode);
											}
										}
										return cbe();
									},
									function(err, res) {
										return cbs()
									})
							}, function(err, res) {
								// Only change "lastUpdated" date if there are new episodes
								Show.find({
									imdb_id: imdb
								}, function(err, show) {
									if (err) return callback(err, null);
									if (show.episodes != thisEpisodes) {
										Show.update({
												imdb: imdb
											}, {
												$set: {
													episodes: thisEpisodes,
													last_updated: +new Date(),
													num_seasons: numSeasons
												}
											},
											function(err, show) {
												return callback(err, null);
											});
									} else {
										return callback(null, show);
									}
								});

							});
						}
					});

				} catch (err) {
					console.error("Error Show Find:", err);
					return callback(err, null);
				}

			}

		});
	},


	refreshDatabase: function() {
		var allShows = [];
		var that = this;
		async.each(providers, function(provider, cb) {
			provider.getAllShows(function(err, shows) {
				if (err) return console.error(err);
				allShows.push(shows);
				cb();
			});
		}, function(error) {
			// 2 process?
			async.mapLimit(allShows[0], 2, helpers.extractTrakt, function(err, results) {
				console.log("Update complete" + JSON.stringify(err));
				config.lastRefresh = new Date;
			});
		});
	},

	extractTrakt: function(show, callback) {
		var that = this;
		var slug = show.slug;
		try {
			console.log("Extracting " + show.show);
			Show.findOne({
				slug: slug
			}, function(err, doc) {

				if (err || !doc) {
					console.log("New Show : " + slug);
					try {
						trakt.show(slug, {extended:'full,images'},function(err, data) {
							if (!err && data) {
								// make sure trakt returned something valid
								if (!data.ids.imdb) {
									return callback(null, show);
								}

								data.images.lowres = data.images.poster.medium
								data.images.fanart = data.images.fanart.full;

								// ok show exist
								var newShow = new Show({
									_id: data.ids.imdb,
									imdb_id: data.ids.imdb,
									tvdb_id: data.ids.tvdb,
									title: data.title,
									year: data.year,
									images: data.images,
									slug: slug,
									synopsis: data.overview,
									runtime: data.runtime,
									rating: data.rating,
									genres: data.genres,
									country: data.country,
									network: data.network,
									air_day: data.air_day,
									air_time: data.air_time,
									status: data.status,
									num_seasons: 0,
									last_updated: 0
								});

								console.log("New Trakt Saved Show" + JSON.stringify(newShow));
								newShow.save(function(err, newDocs) {
									show.imdb_id = data.ids.imdb;
									helpers.extractShowInfo(show, function(err, show) {
										return callback(err, show);
									});
								});
							} else {
								return callback(null, show);
							}
						})
					} catch (err) {
						console.error("Error Ancuk:", err)
						return callback(null, show);
					}
				} else {
					console.log("Existing Show: Checking TTL");
					// compare with current time
					var now = +new Date();
					if ((now - doc.last_updated) > TTL) {
						console.log("TTL expired, updating info");
						show.imdb_id = doc.imdb_id;
						//TODO: Change this to just get new rating or something
						try {
							trakt.show(slug, {extended:'full,images'}, function(err, data) {
								if (!err && data) {
									Show.update({
											_id: doc._id
										}, {
											$set: {
												rating: data.ratings,
												status: data.status
											}
										},
										function(err, doc1) {
											helpers.extractShowInfo(show, function(err, show) {
												return callback(err, show);
											});
										});
								}
							});
						} catch (err) {
							console.error("Error Expired:", err)
							return callback(err, null);
						}
					} else {
						return callback(null, show);
					}
				}
			});

		} catch (err) {
			console.error("Error juncak:", err)
			return callback(err, null);
		}

	},


}

module.exports = helpers;
