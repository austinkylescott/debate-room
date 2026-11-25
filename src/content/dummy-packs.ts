// Dummy Packs for checking the look and feel while the real Featured Packs (#19)
// are written. Not curated content.

export interface Pack {
  id: string;
  topic: string;
  name: string;
  prompts: string[];
}

export const DUMMY_PACKS: Pack[] = [
  {
    id: "dummy-food",
    topic: "Food",
    name: "Kitchen Table Fights",
    prompts: [
      "Pineapple belongs on pizza",
      "Breakfast is the best meal of the day",
      "A hot dog is a sandwich",
      "Cereal is a soup",
      "Spicy food is overrated",
    ],
  },
  {
    id: "dummy-pets",
    topic: "Pets",
    name: "Cats vs Dogs",
    prompts: [
      "Pets should be allowed in restaurants",
      "A pet can be your best friend",
      "Everyone should adopt rather than buy",
      "Pets make a home better",
    ],
  },
  {
    id: "dummy-tech",
    topic: "Technology",
    name: "Screens and Feeds",
    prompts: [
      "Social media does more harm than good",
      "Kids shouldn't have phones before 13",
      "Remote work beats the office",
      "AI will make most jobs better",
      "Group chats should have a mute-all button",
    ],
  },
];
