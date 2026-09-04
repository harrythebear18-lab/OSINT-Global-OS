import type { TripParams, Pace, PackWeight, ExperienceLevel, WeatherCondition, TimeOfDay, AgeGroup, FitnessLevel } from '@shared/types'

interface TripParamsPanelProps {
  params: TripParams
  onChange: (params: TripParams) => void
}

const PACE_OPTIONS: { value: Pace; label: string; speed: string }[] = [
  { value: 'slow', label: 'Slow', speed: '2 km/h' },
  { value: 'normal', label: 'Normal', speed: '4 km/h' },
  { value: 'fast', label: 'Fast', speed: '6 km/h' },
]

const PACK_OPTIONS: { value: PackWeight; label: string; weight: string }[] = [
  { value: 'light', label: 'Light', weight: '~15 kg' },
  { value: 'medium', label: 'Medium', weight: '~25 kg' },
  { value: 'heavy', label: 'Heavy', weight: '~35 kg' },
]

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string; threshold: string }[] = [
  { value: 'novice', label: 'Novice', threshold: '25° max' },
  { value: 'experienced', label: 'Experienced', threshold: '35° max' },
  { value: 'expert', label: 'Expert', threshold: '45° max' },
]

const WEATHER_OPTIONS: { value: WeatherCondition; label: string; icon: string }[] = [
  { value: 'clear', label: 'Clear', icon: '☀' },
  { value: 'cloudy', label: 'Cloudy', icon: '☁' },
  { value: 'rain', label: 'Rain', icon: '🌧' },
  { value: 'snow', label: 'Snow', icon: '❄' },
  { value: 'extreme', label: 'Extreme', icon: '⚠' },
]

const TOD_OPTIONS: { value: TimeOfDay; label: string; icon: string }[] = [
  { value: 'morning', label: 'Morning', icon: '🌅' },
  { value: 'midday', label: 'Midday', icon: '☀' },
  { value: 'afternoon', label: 'Afternoon', icon: '🌤' },
  { value: 'night', label: 'Night', icon: '🌙' },
]

const AGE_OPTIONS: { value: AgeGroup; label: string }[] = [
  { value: 'young', label: 'Young' },
  { value: 'adult', label: 'Adult' },
  { value: 'elderly', label: 'Elderly' },
]

const FITNESS_OPTIONS: { value: FitnessLevel; label: string }[] = [
  { value: 'unfit', label: 'Unfit' },
  { value: 'average', label: 'Average' },
  { value: 'fit', label: 'Fit' },
]

/**
 * Trip Parameters panel — timeframe slider + multi-day hike parameters.
 * These drive all analysis models (search zone expansion, rest point scoring,
 * slope thresholds, survival window).
 */
export function TripParamsPanel({ params, onChange }: TripParamsPanelProps) {
  const update = <K extends keyof TripParams>(key: K, value: TripParams[K]) => {
    onChange({ ...params, [key]: value })
  }

  const hoursLabel = params.hoursSinceLastSeen < 24
    ? `${params.hoursSinceLastSeen}h since last seen`
    : `${Math.floor(params.hoursSinceLastSeen / 24)}d ${params.hoursSinceLastSeen % 24}h since last seen`

  return (
    <section className="panel trip-params-panel">
      <h2>Trip Parameters</h2>

      {/* Timeframe slider */}
      <div className="param-group">
        <label className="param-label">{hoursLabel}</label>
        <input
          type="range"
          min={1}
          max={72}
          value={params.hoursSinceLastSeen}
          onChange={(e) => update('hoursSinceLastSeen', parseInt(e.target.value))}
          className="param-slider"
        />
        <div className="slider-ticks">
          <span>1h</span>
          <span>24h</span>
          <span>48h</span>
          <span>72h</span>
        </div>
      </div>

      {/* Day stepper */}
      <div className="param-group">
        <label className="param-label">Day {params.day}</label>
        <div className="day-stepper">
          <button
            className="step-btn"
            onClick={() => update('day', Math.max(1, params.day - 1))}
            disabled={params.day <= 1}
          >
            −
          </button>
          <span className="day-value">{params.day}</span>
          <button
            className="step-btn"
            onClick={() => update('day', Math.min(7, params.day + 1))}
            disabled={params.day >= 7}
          >
            +
          </button>
        </div>
        <p className="param-hint muted">Fatigue factor: day {params.day} = {Math.max(50, 100 - (params.day - 1) * 15)}% speed</p>
      </div>

      {/* Pace */}
      <div className="param-group">
        <label className="param-label">Pace</label>
        <div className="btn-group">
          {PACE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`opt-btn ${params.pace === opt.value ? 'active' : ''}`}
              onClick={() => update('pace', opt.value)}
              title={opt.speed}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pack weight */}
      <div className="param-group">
        <label className="param-label">Pack Weight</label>
        <div className="btn-group">
          {PACK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`opt-btn ${params.packWeight === opt.value ? 'active' : ''}`}
              onClick={() => update('packWeight', opt.value)}
              title={opt.weight}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Experience */}
      <div className="param-group">
        <label className="param-label">Experience</label>
        <div className="btn-group">
          {EXPERIENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`opt-btn ${params.experience === opt.value ? 'active' : ''}`}
              onClick={() => update('experience', opt.value)}
              title={opt.threshold}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Weather */}
      <div className="param-group">
        <label className="param-label">Weather</label>
        <div className="btn-group">
          {WEATHER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`opt-btn ${params.weather === opt.value ? 'active' : ''}`}
              onClick={() => update('weather', opt.value)}
              title={opt.label}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Temperature */}
      <div className="param-group">
        <label className="param-label">Temperature: {params.temperatureC}°C ({Math.round(params.temperatureC * 9/5 + 32)}°F)</label>
        <input
          type="range"
          min={-10}
          max={45}
          value={params.temperatureC}
          onChange={(e) => update('temperatureC', parseInt(e.target.value))}
          className="param-slider"
        />
        <div className="slider-ticks">
          <span>-10°</span>
          <span>10°</span>
          <span>25°</span>
          <span>45°</span>
        </div>
      </div>

      {/* Time of day */}
      <div className="param-group">
        <label className="param-label">Time of Day</label>
        <div className="btn-group">
          {TOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`opt-btn ${params.timeOfDay === opt.value ? 'active' : ''}`}
              onClick={() => update('timeOfDay', opt.value)}
              title={opt.label}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Age + Fitness */}
      <div className="param-row">
        <div className="param-group half">
          <label className="param-label">Age Group</label>
          <div className="btn-group">
            {AGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`opt-btn ${params.ageGroup === opt.value ? 'active' : ''}`}
                onClick={() => update('ageGroup', opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="param-group half">
          <label className="param-label">Fitness</label>
          <div className="btn-group">
            {FITNESS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`opt-btn ${params.fitness === opt.value ? 'active' : ''}`}
                onClick={() => update('fitness', opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
