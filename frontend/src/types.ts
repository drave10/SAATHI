export type Role = 'beneficiary' | 'caseworker' | 'admin'
export type Level = 'routine' | 'attention' | 'urgent'

export interface User {
  id: number; username: string; display_name: string; role: Role; is_active: boolean
  is_synthetic: boolean; created_at: string; last_login_at: string | null
}

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface Question {
  id: string; dimension: string; type: 'likert' | 'text'; text: string
  options: { value: number; label: string }[]; critical: boolean; required: boolean; help: string | null
}
export interface Questionnaire {
  version: string; title: string; disclaimer: string; dimensions: Record<string, string>; items: Question[]
}

export interface CaseRow {
  id: number; code: string; display_name: string; org_unit: string; case_status: string; is_synthetic: boolean
  caseworker_id: number | null; caseworker_name: string | null; deletion_requested: boolean
  latest?: { assessment_id: number; submitted_at: string; priority_level: Level | null; overall_score: number | null; review_status: string | null; delta: number | null } | null
  needs_review?: boolean; open_alerts?: number; requested_followups?: number
  next_followup?: string | null; overdue_followups?: number; assessment_due?: boolean
}

export interface Factor { code: string; label: string; severity: string; detail: string; dimension: string | null; value: number | null }

export interface FollowUp {
  id: number; beneficiary_id: number; caseworker_id: number | null; status: string; kind: string
  scheduled_for: string | null; requested_by_beneficiary: boolean; reason: string | null
  outcome_notes: string | null; completed_at: string | null; created_at: string; is_overdue: boolean
  beneficiary_code?: string; beneficiary_name?: string
}

export interface Intervention {
  id: number; beneficiary_id: number; type: string; description: string; outcome: string | null
  outcome_notes: string | null; occurred_at: string; beneficiary_code?: string; beneficiary_name?: string
}

export interface Alert {
  id: number; assessment_id: number; beneficiary_id: number; level: Level; reason: string; status: string
  created_at: string; beneficiary_code?: string; beneficiary_name?: string
}

export interface Resource {
  id: number; title: string; category: 'education' | 'support' | 'emergency'; summary: string; body: string
  contact: string | null; region: string | null; is_verified: boolean; is_active: boolean
}

export interface TimelinePoint {
  assessment_id: number; submitted_at: string; priority_level: Level | null; overall_score: number | null
  dimension_scores: Record<string, number | null>; review_status: string | null; top_factors: string[]
}

export interface CaseProfile {
  profile: CaseRow; age_band: string | null; preferred_language: string; created_at: string
  timeline: TimelinePoint[]
  latest_explanation: { assessment_id: number; factors: Factor[]; change_summary: any; data_quality: any; ml_advisory: any } | null
  alerts: Alert[]; follow_ups: FollowUp[]; interventions: Intervention[]
  notes: { id: number; body: string; author_name: string | null; created_at: string; is_synthetic: boolean }[]
}

export const DIMENSION_LABELS: Record<string, string> = {
  emotional: 'Emotional well-being', stress: 'Stress', sleep: 'Sleep quality', safety: 'Feelings of safety',
  social: 'Social support', difficulties: 'Emotional difficulties', functioning: 'Daily activities',
}
