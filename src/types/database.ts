export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    PostgrestVersion: "12"
    Tables: {
      users: {
        Row: {
          id: string
          name: string
          email: string
          phone: string | null
          whatsapp: string | null
          padrinho: string | null
          apelido: string | null
          observacao: string | null
          is_manual: boolean
          provider: string
          approved: boolean
          paid: boolean
          is_admin: boolean
          status: 'email_pendente' | 'aprovacao_pendente' | 'aprovado'
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          email: string
          phone?: string | null
          whatsapp?: string | null
          padrinho?: string | null
          apelido?: string | null
          observacao?: string | null
          is_manual?: boolean
          provider?: string
          approved?: boolean
          paid?: boolean
          is_admin?: boolean
          status?: 'email_pendente' | 'aprovacao_pendente' | 'aprovado'
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          email?: string
          phone?: string | null
          whatsapp?: string | null
          padrinho?: string | null
          apelido?: string | null
          observacao?: string | null
          is_manual?: boolean
          provider?: string
          approved?: boolean
          paid?: boolean
          is_admin?: boolean
          status?: 'email_pendente' | 'aprovacao_pendente' | 'aprovado'
          created_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          id: string
          match_number: number
          phase: MatchPhase
          group_name: string | null
          round: number | null
          team_home: string
          team_away: string
          flag_home: string
          flag_away: string
          match_datetime: string
          city: string
          score_home: number | null
          score_away: number | null
          penalty_winner: string | null
          is_brazil: boolean
          betting_deadline: string
        }
        Insert: {
          id?: string
          match_number: number
          phase: MatchPhase
          group_name?: string | null
          round?: number | null
          team_home: string
          team_away: string
          flag_home: string
          flag_away: string
          match_datetime: string
          city: string
          score_home?: number | null
          score_away?: number | null
          penalty_winner?: string | null
          is_brazil?: boolean
          betting_deadline: string
        }
        Update: {
          id?: string
          match_number?: number
          phase?: MatchPhase
          group_name?: string | null
          round?: number | null
          team_home?: string
          team_away?: string
          flag_home?: string
          flag_away?: string
          match_datetime?: string
          city?: string
          score_home?: number | null
          score_away?: number | null
          penalty_winner?: string | null
          is_brazil?: boolean
          betting_deadline?: string
        }
        Relationships: []
      }
      participants: {
        Row: {
          id: string
          apelido: string
          bio: string | null
          paid: boolean
          padrinho: string | null
          observacao: string | null
          created_at: string
        }
        Insert: {
          id?: string
          apelido: string
          bio?: string | null
          paid?: boolean
          padrinho?: string | null
          observacao?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          apelido?: string
          bio?: string | null
          paid?: boolean
          padrinho?: string | null
          observacao?: string | null
          created_at?: string
        }
        Relationships: []
      }
      user_participants: {
        Row: {
          id: string
          user_id: string
          participant_id: string
          is_primary: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          participant_id: string
          is_primary?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          participant_id?: string
          is_primary?: boolean
          created_at?: string
        }
        Relationships: []
      }
      bets: {
        Row: {
          id: string
          participant_id: string
          match_id: string
          score_home: number
          score_away: number
          points: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          participant_id: string
          match_id: string
          score_home: number
          score_away: number
          points?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          participant_id?: string
          match_id?: string
          score_home?: number
          score_away?: number
          points?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      group_bets: {
        Row: {
          id: string
          participant_id: string
          group_name: string
          first_place: string
          second_place: string
          points: number | null
        }
        Insert: {
          id?: string
          participant_id: string
          group_name: string
          first_place: string
          second_place: string
          points?: number | null
        }
        Update: {
          id?: string
          participant_id?: string
          group_name?: string
          first_place?: string
          second_place?: string
          points?: number | null
        }
        Relationships: []
      }
      tournament_bets: {
        Row: {
          id: string
          participant_id: string
          champion: string
          runner_up: string
          semi1: string
          semi2: string
          top_scorer: string
          points: number | null
        }
        Insert: {
          id?: string
          participant_id: string
          champion: string
          runner_up: string
          semi1: string
          semi2: string
          top_scorer: string
          points?: number | null
        }
        Update: {
          id?: string
          participant_id?: string
          champion?: string
          runner_up?: string
          semi1?: string
          semi2?: string
          top_scorer?: string
          points?: number | null
        }
        Relationships: []
      }
      scoring_rules: {
        Row: {
          key: string
          label: string
          points: number
          category: string
          is_zebra_bonus: boolean
        }
        Insert: {
          key: string
          label: string
          points: number
          category: string
          is_zebra_bonus?: boolean
        }
        Update: {
          key?: string
          label?: string
          points?: number
          category?: string
          is_zebra_bonus?: boolean
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          id: string
          user_id: string | null
          email: string
          job_type: string
          etapa_key: string
          message_id: string | null
          status: string
          error_msg: string | null
          sent_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          email: string
          job_type: string
          etapa_key: string
          message_id?: string | null
          status?: string
          error_msg?: string | null
          sent_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          email?: string
          job_type?: string
          etapa_key?: string
          message_id?: string | null
          status?: string
          error_msg?: string | null
          sent_at?: string
        }
        Relationships: []
      }
      third_place_bets: {
        Row: {
          id: string
          participant_id: string
          group_name: string
          team: string
        }
        Insert: {
          id?: string
          participant_id: string
          group_name: string
          team: string
        }
        Update: {
          id?: string
          participant_id?: string
          group_name?: string
          team?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          key: string
          enabled: boolean
          label: string | null
          description: string | null
          updated_at: string | null
        }
        Insert: {
          key: string
          enabled?: boolean
          label?: string | null
          description?: string | null
          updated_at?: string | null
        }
        Update: {
          key?: string
          enabled?: boolean
          label?: string | null
          description?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_alerts: {
        Row: {
          id: string
          message: string
          start_at: string
          end_at: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          message: string
          start_at: string
          end_at?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          message?: string
          start_at?: string
          end_at?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      tournament_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      top_scorer_mapping: {
        Row: {
          raw_name: string
          standardized_name: string
        }
        Insert: {
          raw_name: string
          standardized_name: string
        }
        Update: {
          raw_name?: string
          standardized_name?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          name: string
          abbr_br: string
          abbr_fifa: string
          group_name: string
        }
        Insert: {
          name: string
          abbr_br?: string
          abbr_fifa?: string
          group_name: string
        }
        Update: {
          name?: string
          abbr_br?: string
          abbr_fifa?: string
          group_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// ── Tipos auxiliares ──────────────────────────────────────────────────────────

export type MatchPhase =
  | 'group'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarterfinal'
  | 'semifinal'
  | 'third_place'
  | 'final'

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type UserRow          = Tables<'users'>
export type MatchRow         = Tables<'matches'>
export type BetRow           = Tables<'bets'>
export type GroupBetRow      = Tables<'group_bets'>
export type TournamentBetRow = Tables<'tournament_bets'>
export type AdminAlertRow    = Tables<'admin_alerts'>
export type ParticipantRow   = Tables<'participants'>
export type TeamRow          = Tables<'teams'>
export type UserParticipantRow = Tables<'user_participants'>
