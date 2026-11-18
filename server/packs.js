// Built-in chit categories. Each pack needs at least MAX_PLAYERS (8) items.
// Plain, general words only - no real people's names (personality rights),
// so the game stays safe to share. Players can always write their own chits.

export const PACKS = [
  {
    id: 'tiffin',
    name: 'Tiffin Box',
    emoji: '🍛',
    items: [
      'Idli', 'Dosa', 'Vada', 'Pongal', 'Upma', 'Appam', 'Puttu', 'Pesarattu',
      'Bisi Bele Bath', 'Idiyappam', 'Uttapam', 'Paniyaram', 'Poori', 'Kesari',
      'Payasam', 'Lemon Rice', 'Curd Rice', 'Sambar',
    ],
  },
  {
    id: 'snacks',
    name: 'Snack Shop',
    emoji: '🍬',
    items: [
      'Murukku', 'Thattai', 'Seedai', 'Banana Chips', 'Mixture', 'Kadalai Mittai',
      'Ribbon Pakoda', 'Boondi', 'Kara Sev', 'Mysore Pak', 'Jangiri', 'Palkova',
      'Halwa', 'Bajji', 'Bonda', 'Samosa',
    ],
  },
  {
    id: 'school',
    name: 'School Days',
    emoji: '🎒',
    items: [
      'Slate', 'Chalk Piece', 'Geometry Box', 'Ink Pen', 'Lunch Box', 'Duster',
      'Compass', 'Eraser', 'Sharpener', 'PT Period', 'Water Bottle', 'Homework',
      'Ruler', 'Notebook', 'Bus Pass', 'Report Card',
    ],
  },
  {
    id: 'flowers',
    name: 'Flowers',
    emoji: '🌼',
    items: [
      'Jasmine', 'Rose', 'Lotus', 'Marigold', 'Hibiscus', 'Sunflower', 'Lily',
      'Kanakambaram', 'Chrysanthemum', 'Oleander', 'Champak', 'Frangipani',
      'Tulip', 'Daisy',
    ],
  },
  {
    id: 'fruits',
    name: 'Fruits',
    emoji: '🥭',
    items: [
      'Mango', 'Jackfruit', 'Banana', 'Guava', 'Papaya', 'Sapota', 'Custard Apple',
      'Pomegranate', 'Jamun', 'Pineapple', 'Watermelon', 'Tender Coconut', 'Amla',
      'Grapes',
    ],
  },
  {
    id: 'festivals',
    name: 'Festivals',
    emoji: '🪔',
    items: [
      'Pongal', 'Onam', 'Ugadi', 'Diwali', 'Sankranti', 'Vishu', 'Dasara',
      'Christmas', 'Eid', 'Karthigai Deepam', 'Navaratri', 'Ganesh Chaturthi',
      'Holi', 'New Year',
    ],
  },
  {
    id: 'places',
    name: 'Places',
    emoji: '🗺️',
    items: [
      'Chennai', 'Bengaluru', 'Hyderabad', 'Kochi', 'Madurai', 'Mysuru', 'Ooty',
      'Munnar', 'Puducherry', 'Tirupati', 'Hampi', 'Kanyakumari', 'Coimbatore',
      'Visakhapatnam', 'Mangaluru', 'Alleppey',
    ],
  },
  {
    id: 'animals',
    name: 'Animals',
    emoji: '🐘',
    items: [
      'Elephant', 'Peacock', 'Tiger', 'Monkey', 'Cow', 'Parrot', 'Crow',
      'Squirrel', 'Cobra', 'Lion', 'Deer', 'Bear', 'Kingfisher', 'Goat',
    ],
  },
];

export const CUSTOM_PACK_ID = 'custom';

export function getPack(id) {
  return PACKS.find((p) => p.id === id) || null;
}

export function packSummaries() {
  return PACKS.map(({ id, name, emoji, items }) => ({ id, name, emoji, sample: items.slice(0, 4) }));
}
