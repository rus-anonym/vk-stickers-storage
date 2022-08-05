const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const axios = require("axios");
const { API } = require(`vk-io`);

const config = {
	api: {
		token: process.env.TOKEN,
		version: "5.160",
	},
	output: {
		path: path.resolve("./static"),
		assets: "./assets",
	},
};

const api = new API({
	token: config.api.token,
	apiVersion: config.api.version,
});

const validateConfig = () => {
	mkdir(config.output.path);

	if (!fs.lstatSync(config.output.path).isDirectory()) {
		console.error("Output path is not a directory");
		process.exit();
	}

	config.output.assets = path.join(
		config.output.path,
		path.dirname(config.output.assets),
	);
};

const log = (text) => {
	return console.log(`${new Date().toISOString()}: ${text}`);
};

const parseStickerPack = (pack) => {
	const type = pack.product.has_animation ? "animated" : "simple";
	const {
		author,
		description,
		product: { id, title, url },
	} = pack;

	const previews = Object.keys(pack)
		.filter((x) => /photo_\d+/.test(x))
		.map((x) => [x, pack[x]])
		.reduce((acc, obj) => {
			acc[obj[0]] = obj[1];
			return acc;
		}, {});

	const parseSticker = (sticker) => {
		if (type === "animated") {
			return {
				id: sticker.sticker_id,
				animation: sticker.animation_url,
			};
		} else {
			return {
				id: sticker.sticker_id,
				images: sticker.images.reduce((acc, obj) => {
					acc[obj.width] = obj.url;
					return acc;
				}, {}),
			};
		}
	};

	const stickers = pack.product.stickers
		.map(parseSticker)
		.sort((a, b) => (a.id < b.id ? -1 : 1));

	log(`Parsed pack ${id} (${title})`);

	return {
		id,
		type,
		author,
		title,
		description,
		url,
		previews,
		stickers,
	};
};

const mkdir = (path) => {
	if (!fs.existsSync(path)) {
		fs.mkdirSync(path);
	}
};

const loadAssets = async (pack) => {
	log(`Loading assets pack ${pack.id} (${pack.title})`);
	const meta = { ...pack, previews: [], stickers: [] };
	mkdir(config.output.assets);

	const packPath = path.join(config.output.assets, pack.id.toString());
	mkdir(packPath);

	const previewPath = path.join(packPath, "previews");
	const stickersPath = path.join(packPath, "stickers");

	mkdir(previewPath);
	mkdir(stickersPath);

	for (const [key, url] of Object.entries(pack.previews)) {
		try {
			const response = await axios.get(url, { responseType: "arraybuffer" });
			const filePath = path.join(previewPath, key.split("_")[1] + ".jpeg");
			fs.writeFileSync(filePath, response.data);
			meta.previews.push(Number(key.split("_")[1]));
		} catch (error) {}
	}

	log(`Previews ${pack.id} (${pack.title}) loaded`);

	const loadSticker = async (sticker) => {
		if (pack.type === "animated") {
			try {
				const response = await axios.get(sticker.animation, {
					responseType: "arraybuffer",
				});
				const filePath = path.join(stickersPath, `${sticker.id}.json`);
				fs.writeFileSync(filePath, response.data);
				meta.stickers.push(sticker.id);
			} catch (error) {}
		} else {
			const stickerPath = path.join(stickersPath, sticker.id.toString());
			mkdir(stickerPath);

			const metaStickerInfo =
				meta.stickers[
					meta.stickers.push({
						id: sticker.id,
						images: [],
					}) - 1
				];

			for (const [key, url] of Object.entries(sticker.images)) {
				try {
					const response = await axios.get(url, {
						responseType: "arraybuffer",
					});
					const filePath = path.join(stickerPath, key + ".png");
					fs.writeFileSync(filePath, response.data);
					metaStickerInfo.images.push(Number(key));
				} catch (error) {}
			}
		}
	};

	await Promise.all(pack.stickers.map(loadSticker));

	log(`Asset pack ${pack.id} (${pack.title}) loaded`);

	fs.writeFileSync(path.join(packPath, "meta.json"), JSON.stringify(meta));

	execSync("git add .", { cwd: packPath }).toString();
};

const extractMeta = (pack) => {
	const packInfo = JSON.parse(
		fs
			.readFileSync(
				path.join(config.output.assets, pack.id.toString(), "meta.json"),
			)
			.toString(),
	);

	return packInfo;
};

void (async () => {
	validateConfig();

	const response = [];

	let offset = 0;
	const chunkCount = 50;

	while (offset < 2500) {
		const startOffset = offset + 1;
		log(`Get ${startOffset} - ${startOffset + chunkCount - 1} stickers`);

		const { items } = await api.call(`store.getStockItems`, {
			type: "stickers",
			lang: "ru",
			product_ids: Array.from({ length: chunkCount }, () => ++offset),
		});

		const parsedStickerPacks = items
			.filter((item) => !Array.isArray(item))
			.map(parseStickerPack);

		if (parsedStickerPacks.length === 0) {
			continue;
		}

		await Promise.all(parsedStickerPacks.map(loadAssets));
		response.push(...parsedStickerPacks);

		fs.writeFileSync(
			path.join(config.output.path, "stickers.json"),
			JSON.stringify(response),
		);
		fs.writeFileSync(
			path.join(config.output.path, "meta.json"),
			JSON.stringify(response.map(extractMeta)),
		);
		execSync(`git add ./stickers.json`, { cwd: config.output.path }).toString();
		execSync(`git add ./meta.json`, { cwd: config.output.path }).toString();
		execSync(
			`git commit -m "${startOffset} - ${
				startOffset + chunkCount - 1
			} packs" --no-verify`,
			{
				cwd: config.output.path,
			},
		).toString();
		execSync(`git gc --force`, {
			cwd: config.output.path,
		}).toString();
		execSync(`git push --force origin static`, {
			cwd: config.output.path,
		}).toString();
	}

	log(`Parsed all stickers (${response.length} packs)`);
})();
