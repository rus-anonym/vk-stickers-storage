# Structure

```typescript
interface ISticker {
	id: number;
	images: number;
}

interface IPack {
	id: number;
	type: "simple";
	author: string;
	title: string;
	description: string;
	url: string;
	previews: number[];
	stickers: ISticker[];
}

interface IAnimatedPack {
	id: number;
	type: "animated";
	author: string;
	title: string;
	description: string;
	url: string;
	previews: number[];
	stickers: number[];
}
```
