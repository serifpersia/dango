export type Profile = {
  id: string
  name: string
  owner: boolean
  protected: boolean
  avatar: string | null
  cloudAvatar: string | null
}
export type CurrentProfile = Profile & { image: string | null }
