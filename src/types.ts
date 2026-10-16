export type Sex = 'female' | 'male';

/** 活動レベル（TDEE 係数） */
export type ActivityLevel = 'low' | 'normal' | 'high' | 'veryHigh';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Profile {
  nickname: string;
  oshiName: string;
  /** 推しカラー（#rrggbb） */
  oshiColor: string;
  eventName: string;
  /** 写真会の日付（YYYY-MM-DD） */
  eventDate: string;
  sex: Sex;
  age: number;
  heightCm: number;
  startWeightKg: number;
  targetWeightKg: number;
  activity: ActivityLevel;
  /** 記録開始日（YYYY-MM-DD） */
  startDate: string;
}

export interface Meal {
  id: string;
  date: string;
  type: MealType;
  name: string;
  kcal: number;
}

export interface WeightEntry {
  date: string;
  kg: number;
}

export interface AppData {
  profile: Profile | null;
  meals: Meal[];
  weights: WeightEntry[];
}
