export interface UserProfileField {
  key: string
  label: string
  value: string
  updated_at?: string
}

export interface UserProfileSection {
  id: string
  title: string
  fields: UserProfileField[]
}

export interface UserProfile {
  user_id: string
  sections: UserProfileSection[]
  updated_at?: string
}

export interface UserProfileResponse {
  profile: UserProfile
}
