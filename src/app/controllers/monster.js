const Controller = require('./controller')
const log = require('../logger');
const config = require('config');

const _ = require('lodash')
const mustache = require('mustache');


const monsterData = require(config.locale.monstersJson)
const teamData = require('../util/teams')
const weatherData = require('../util/weather')
const raidCpData = require('../util/raidcp')
const questData = require('../util/quests')
const rewardData = require('../util/rewards')
const moveData = require(config.locale.movesJson)
const ivColorData = config.discord.iv_colors
const moment = require('moment')
require('moment-precise-range-plugin');

const dts = require('../../../config/dts')
class Monster extends Controller{

/*
*
*
*
*
* monsterWhoCares, takes data object
*/
	async monsterWhoCares(data) {
		return new Promise(resolve => {
			let areastring = `humans.area like '%${data.matched[0] || 'doesntexist'}%' `;
			data.matched.forEach((area) => {
				areastring = areastring.concat(`or humans.area like '%${area}%' `);
			});
			const query =
				`select * from monsters 
            join humans on humans.id = monsters.id
            where humans.enabled = 1 and
            pokemon_id=${data.pokemon_id} and 
            min_iv<=${data.iv} and
            max_iv>=${data.iv} and
            min_cp<=${data.cp} and
            max_cp>=${data.cp} and
            (form = ${data.form} or form = 0) and
            min_level<=${data.pokemon_level} and
            max_level>=${data.pokemon_level} and
            atk<=${data.individual_attack} and
            def<=${data.individual_defense} and
            sta<=${data.individual_stamina} and
            min_weight<=${data.weight} * 1000 and
            max_weight>=${data.weight} * 1000 and
            (round( 6371000 * acos( cos( radians(${data.latitude}) ) 
              * cos( radians( humans.latitude ) ) 
              * cos( radians( humans.longitude ) - radians(${data.longitude}) ) 
              + sin( radians(${data.latitude}) ) 
              * sin( radians( humans.latitude ) ) ) < monsters.distance and monsters.distance != 0) or
               monsters.distance = 0 and (${areastring}))
               group by humans.id`


			log.debug(`Query constructed for monsterhWhoCares: \n ${query}`)
			this.db.query(query)
				.then(
					function(result){
						log.info(`${data.name} appeared and ${result[0].length} humans cared`);
						resolve(result[0])
					}
				)
				.catch((err) => {log.error(`monsterWhoCares errored with: ${err}`)})
		})
	}

	findIvColor(iv) {

		// it must be perfect if none of the ifs kick in
		// orange / legendary
		let colorIdx = 5;

		if (iv < 25) colorIdx = 0; // gray / trash / missing
		else if (iv < 50) colorIdx = 1; // white / common
		else if (iv < 82) colorIdx = 2; // green / uncommon
		else if (iv < 90) colorIdx = 3; // blue / rare
		else if (iv < 100) colorIdx = 4; // purple epic

		return parseInt(ivColorData[colorIdx].replace(/^#/, ''), 16);
	}

	async handle(data){
		return new Promise(resolve => {
			switch(config.geocoding.provider.toLowerCase()){
				case "google":{
					data.staticmap = `https://maps.googleapis.com/maps/api/staticmap?center=${data.latitude},${data.longitude}&markers=color:red|${data.latitude},${data.longitude}&maptype=${config.gmaps.type}&zoom=${config.gmaps.zoom}&size=${config.gmaps.width}x${config.gmaps.height}&key=${_.sample(config.geocoding.googleKey)}`;
					break
				}
				case "osm":{
					data.staticmap = ``
					break
				}
			}

			data.name = monsterData[data.pokemon_id].name || 'errormon'
			data.formname = '';
			data.iv = ((data.individual_attack + data.individual_defense + data.individual_stamina) / 0.45).toFixed(2) || -1
			data.individual_attack = data.individual_attack || 0
			data.individual_defense = data.individual_defense || 0
			data.individual_stamina = data.individual_stamina || 0
			data.cp = data.cp || 0
			data.pokemon_level = data.pokemon_level || 0
			data.move_1 = data.move_1 || 0
			data.move_2 = data.move_2 || 0
			data.weight = data.weight.toFixed(1) || 0
			data.quick_move = moveData[data.move_1].name || ''
			data.charge_move = moveData[data.move_2].name || ''
			if (data.form === undefined || data.form === null) data.form = 0;
			if (!data.weather_boosted_condition) data.weather_boosted_condition = 0;
			data.boost = weatherData[data.weather_boosted_condition].name || '';
			data.boostemoji = weatherData[data.weather_boosted_condition].emoji || '';
			data.applemap = `https://maps.apple.com/maps?daddr=${data.latitude},${data.longitude}`;
			data.mapurl = `https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`;
			data.color = monsterData[data.pokemon_id].types[0].color || 0;
			data.ivcolor = this.findIvColor(data.iv);
			data.tth = moment.preciseDiff(Date.now(), data.disappear_time * 1000, true);
			data.distime = moment(data.disappear_time * 1000).format(config.locale.time);
			data.imgurl = `${config.general.imgurl}pokemon_icon_${data.pokemon_id.toString().padStart(3, '0')}_${data.form.toString().padStart(2, '0')}.png`;
			let e = [];
			monsterData[data.pokemon_id].types.forEach((type) => {
				e.push(type.emoji);
			});
			data.emoji = e

				// Stop handling if it already disappeared
			if (data.tth.firstDateWasLater){
				log.warn(`Weird, the ${data.name} already disappeared`)
				return null
			}

			this.pointInArea([data.latitude, data.longitude]).then((matchedAreas) => {
				data.matched = matchedAreas
				this.monsterWhoCares(data).then((whocares) => {
					// if noone cares or the result is not iterable, break out of processing
					if (!whocares.length || !Array.isArray(whocares)) return null
					this.getAddress({ lat: data.latitude, lon: data.longitude }).then((geoResult) => {

						let jobs = []
						whocares.forEach((cares) => {


							const view = {
								id: data.pokemon_id,
								time: data.distime,
								tthh: data.tth.hours,
								tthm: data.tth.minutes,
								tths: data.tth.seconds,
								name: data.name,
								move1: data.quick_move,
								move2: data.charge_move,
								iv: data.iv,
								cp: data.cp,
								level: data.pokemon_level,
								atk: data.individual_attack,
								def: data.individual_defense,
								sta: data.individual_stamina,
								weight: data.weight,
								staticmap: data.staticmap,
								mapurl: data.mapurl,
								applemap: data.applemap,
								rocketmap: data.rocketmap,
								form: data.formname,
								imgurl: data.imgurl.toLowerCase(),
								color: data.color,
								ivcolor: data.ivcolor,
								boost: data.boost,
								boostemoji: data.boostemoji,

								// geocode stuff
								lat: data.latitude.toString().substring(0, 8),
								lon: data.longitude.toString().substring(0, 8),
								addr: geoResult.addr,
								streetNumber: geoResult.streetNumber,
								streetName: geoResult.streetName,
								zipcode: geoResult.zipcode,
								country: geoResult.country,
								countryCode: geoResult.countryCode,
								city: geoResult.city,
								state: geoResult.state,
								stateCode: geoResult.stateCode,
							};
							const monsterDts = data.iv === -1 && dts.monsterNoIv
								? dts.monsterNoIv
								: dts.monster;
							const template = JSON.stringify(monsterDts);
							let message = mustache.render(template, view);
							message = JSON.parse(message);

							let work = {
								message: message,
								target: cares.id,
								name: cares.name,
								emoji: data.emoji
							}
							jobs.push(work)

						})
						resolve(jobs)

					})
				})
			})

		})
	}
}

module.exports = Monster