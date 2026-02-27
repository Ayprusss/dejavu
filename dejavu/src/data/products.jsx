import arlo1 from '../Pages/Shop/arlo_1.webp';
import arlo2 from '../Pages/Shop/arlo_2.webp';
import arlo3 from '../Pages/Shop/arlo_3.webp';
import arlo4 from '../Pages/Shop/arlo_4.jpg';
import arlo5 from '../Pages/Shop/arlo_5.jpg';
import isaac1 from '../Pages/Shop/isaac-1.jpg';
import isaac2 from '../Pages/Shop/isaac-2.jpg';
import isaac3 from '../Pages/Shop/isaac-3.jpg';
import luke1 from '../Pages/Shop/luke_1.jpg';

export const SIZE_GUIDE_ROWS = ['Shoulder', 'Sleeve', 'Length', 'Chest'];
export const SIZE_GUIDE_UNITS_LABEL = 'inch/cm';

export const PRODUCTS = [
  {
    id: 'weston',
    name: 'Weston Crinkled Leather Jacket in Goat leather',
    priceUsd: 1980,
    priceLabel: '$1,980.00 USD',
    cardStatus: 'Sold Out',
    cardStatusTone: 'is-default',
    imageAlt: 'Model wearing a black leather jacket with a neutral studio backdrop',
    images: [
      { src: isaac1, alt: 'Weston crinkled leather jacket front view' },
      { src: isaac2, alt: 'Weston crinkled leather jacket rear view' },
      { src: isaac3, alt: 'Weston crinkled leather jacket editorial view' },
    ],
    sizes: [
      { label: 'S', stock: 0 },
      { label: 'M', stock: 0 },
      { label: 'L', stock: 2 },
    ],
    defaultSize: 'S',
    description: {
      heading: 'Goat Leather',
      paragraphs: [
        'Vintage effect drizzler jacket in creased goat leather with snap button flap pockets, elasticated hem, and chin strap with concealed front zipper and button closure.',
        'Crafted from Italian goat leather, each jacket has been individually creased by hand offering a supple hand and nuanced vintage look.',
      ],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    },
    sizeGuide: {
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['20/51', '20.9/53', '21.3/54'],
        Sleeve: ['23.6/60', '24.2/61.5', '24.8/63'],
        Length: ['24.4/62', '25.2/64', '25.9/66'],
        Chest: ['45.7/116', '47.2/120', '48.4/123'],
      },
    },
  },
  {
    id: 'luca',
    name: 'Luca Deconstructed Tailored Jacket in Wool & Linen',
    priceUsd: 850,
    priceLabel: '$850.00 USD',
    cardStatus: 'low stock',
    cardStatusTone: 'is-low-stock',
    imageAlt: 'Black tailored jacket product image against a soft gray background',
    images: [
      { src: arlo1, alt: 'Luca jacket front view' },
      { src: arlo2, alt: 'Luca jacket rear view' },
      { src: arlo3, alt: 'Luca jacket detail view' },
    ],
    sizes: [
      { label: 'S', stock: 1 },
      { label: 'M', stock: 3 },
      { label: 'L', stock: 1 },
    ],
    defaultSize: 'M',
    description: {
      heading: 'Wool & Linen',
      paragraphs: [
        'A softly structured tailored jacket cut in a dry wool and linen blend with deconstructed internal finishing and light shoulder shape.',
      ],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    },
    sizeGuide: {
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['18.7/47.5', '19.3/49', '19.9/50.5'],
        Sleeve: ['24/61', '24.4/62', '24.8/63'],
        Length: ['29.5/75', '30.1/76.5', '30.7/78'],
        Chest: ['42.5/108', '44.1/112', '45.7/116'],
      },
    },
  },
  {
    id: 'beau',
    name: 'Beau Canvas Jacket in Cotton & Leather',
    priceUsd: 895,
    priceLabel: '$895.00 USD',
    cardStatus: null,
    cardStatusTone: '',
    imageAlt: 'Dark canvas jacket product image centered on a pale gray card',
    images: [
      { src: isaac3, alt: 'Beau jacket front view' },
      { src: arlo4, alt: 'Beau jacket side detail' },
      { src: arlo5, alt: 'Beau jacket texture detail' },
    ],
    sizes: [
      { label: 'S', stock: 0 },
      { label: 'M', stock: 2 },
      { label: 'L', stock: 2 },
    ],
    defaultSize: 'M',
    description: {
      heading: 'Cotton & Leather',
      paragraphs: ['Workwear inspired canvas jacket with leather trims and articulated sleeves.'],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    },
    sizeGuide: {
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['19.3/49', '19.9/50.5', '20.5/52'],
        Sleeve: ['24/61', '24.6/62.5', '25.2/64'],
        Length: ['26/66', '26.8/68', '27.6/70'],
        Chest: ['44.1/112', '45.7/116', '47.2/120'],
      },
    },
  },
  {
    id: 'leon',
    name: 'Leon Drizzler Jacket in Cotton & Cashmere',
    priceUsd: 920,
    priceLabel: '$920.00 USD',
    cardStatus: 'Sold Out',
    cardStatusTone: 'is-default',
    imageAlt: 'Blue drizzler jacket product image against a soft neutral background',
    images: [
      { src: isaac1, alt: 'Leon jacket front view' },
      { src: isaac2, alt: 'Leon jacket rear view' },
      { src: luke1, alt: 'Leon jacket editorial view' },
    ],
    sizes: [
      { label: 'S', stock: 0 },
      { label: 'M', stock: 0 },
      { label: 'L', stock: 0 },
    ],
    defaultSize: 'S',
    description: {
      heading: 'Cotton & Cashmere',
      paragraphs: ['A compact drizzler silhouette with soft hand feel and concealed zip closure.'],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    },
    sizeGuide: {
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['19.1/48.5', '19.7/50', '20.3/51.5'],
        Sleeve: ['23.8/60.5', '24.4/62', '25/63.5'],
        Length: ['25.2/64', '26/66', '26.8/68'],
        Chest: ['43.3/110', '44.9/114', '46.5/118'],
      },
    },
  },
  {
    id: 'ari',
    name: 'Ari Reversible Jacket in Cotton Twill',
    priceUsd: 780,
    priceLabel: '$780.00 USD',
    cardStatus: null,
    cardStatusTone: '',
    imageAlt: 'Dark olive jacket product image with clean editorial framing',
    images: [
      { src: isaac2, alt: 'Ari jacket side A view' },
      { src: isaac1, alt: 'Ari jacket side B view' },
      { src: luke1, alt: 'Ari jacket editorial detail' },
    ],
    sizes: [
      { label: 'S', stock: 2 },
      { label: 'M', stock: 1 },
      { label: 'L', stock: 0 },
    ],
    defaultSize: 'S',
    description: {
      heading: 'Cotton Twill',
      paragraphs: ['Reversible lightweight jacket in washed cotton twill with clean welt pockets.'],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    },
    sizeGuide: {
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['18.9/48', '19.5/49.5', '20.1/51'],
        Sleeve: ['23.6/60', '24.2/61.5', '24.8/63'],
        Length: ['25/63.5', '25.8/65.5', '26.6/67.5'],
        Chest: ['43.3/110', '44.9/114', '46.5/118'],
      },
    },
  },
  {
    id: 'nico',
    name: 'Nico Denim Overshirt in Raw Indigo',
    priceUsd: 640,
    priceLabel: '$640.00 USD',
    cardStatus: null,
    cardStatusTone: '',
    imageAlt: 'Raw indigo overshirt product image on a light studio backdrop',
    images: [
      { src: isaac3, alt: 'Nico overshirt front view' },
      { src: arlo4, alt: 'Nico overshirt back view' },
      { src: arlo5, alt: 'Nico overshirt close detail' },
    ],
    sizes: [
      { label: 'S', stock: 1 },
      { label: 'M', stock: 1 },
      { label: 'L', stock: 1 },
    ],
    defaultSize: 'M',
    description: {
      heading: 'Raw Indigo',
      paragraphs: ['Structured overshirt cut in rigid raw indigo denim with metal snap closure.'],
      modelNote: 'Model is 183cm/6ft wearing a size medium.',
    },
    sizeGuide: {
      columns: ['S', 'M', 'L'],
      measurements: {
        Shoulder: ['18.5/47', '19.1/48.5', '19.7/50'],
        Sleeve: ['24/61', '24.4/62', '24.8/63'],
        Length: ['28.3/72', '29.1/74', '29.9/76'],
        Chest: ['41.7/106', '43.3/110', '44.9/114'],
      },
    },
  },
];

export function getProductById(productId) {
  return PRODUCTS.find((product) => product.id === productId) ?? null;
}

export function isProductSoldOut(product) {
  return !product.sizes?.some((size) => Number(size.stock) > 0);
}
