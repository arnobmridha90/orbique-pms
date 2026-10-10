/* Temporary passwords that are easy to read aloud and type on a phone: "Mango-River-4821".
 * Two different words from a list of 240 plus four digits, all from crypto randomness (about 29 bits).
 * They are used once: the person must choose a new password at first sign-in (must_change_password).
 */
import { randomInt } from 'node:crypto';

const WORDS = (
  'Apple Amber Anchor Apron Arch Aster Badge Bamboo Banana Basil Beach Berry Birch Blossom Bridge Brook ' +
  'Bubble Butter Cabin Cactus Camel Candle Canoe Canyon Carrot Castle Cedar Cherry Chili Cinnamon Citrus Cloud ' +
  'Clover Coast Cobalt Coconut Comet Coral Cotton Cougar Crane Crystal Cypress Daisy Delta Desert Diamond Dolphin ' +
  'Dragon Drift Dune Eagle Echo Ember Emerald Falcon Feather Fern Fig Firefly Flame Flint Forest Fossil ' +
  'Fountain Fox Galaxy Garden Garnet Ginger Glacier Globe Grape Granite Gravel Guava Harbor Harvest Hazel Heron ' +
  'Hibiscus Honey Horizon Iris Island Ivory Jade Jasmine Jungle Kayak Kettle Kite Koala Lagoon Lantern Lava ' +
  'Lemon Lily Lime Linen Lotus Lychee Magnet Mango Maple Marble Meadow Melon Meteor Mint Mirror Monsoon ' +
  'Moon Mosaic Moss Mountain Nectar Nutmeg Oak Ocean Olive Onyx Orange Orbit Orchid Otter Owl Oyster ' +
  'Paddle Palm Panda Papaya Parrot Peach Pearl Pebble Pepper Petal Pine Planet Plum Pocket Pomelo Pony ' +
  'Prairie Prism Puffin Pumpkin Quartz Quill Rabbit Rainbow Raven Reef Ribbon River Robin Rocket Rose Ruby ' +
  'Saffron Sage Sail Salt Sand Sapphire Satin Shell Silver Sky Slate Snow Spark Spice Spruce Star ' +
  'Stone Storm Summit Sun Sunset Swan Tamarind Tangerine Teal Thunder Tiger Topaz Torch Tulip Tundra Turtle ' +
  'Valley Vanilla Velvet Violet Volcano Walnut Water Wave Whale Willow Wind Winter Wolf Yarn Zebra Zephyr ' +
  'Acorn Alpine Atlas Aurora Bay Beacon Bison Bloom Breeze Brick Cliff Copper Cove Creek Dawn Durian ' +
  'Field Frost Gecko Grove Hill Lake Leaf Llama Lynx Marlin Mist Nova Oasis Pecan Pilot Puma'
).split(' ').filter((w) => /^[A-Z][a-z]+$/.test(w));

const LIST = Array.from(new Set(WORDS));

export function tempPassword() {
  const a = LIST[randomInt(LIST.length)];
  let b = LIST[randomInt(LIST.length)];
  while (b === a) b = LIST[randomInt(LIST.length)];
  const digits = String(randomInt(10000)).padStart(4, '0');
  return `${a}-${b}-${digits}`;
}

export const WORD_COUNT = LIST.length;
