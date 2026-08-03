CREATE TABLE IF NOT EXISTS regions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  province VARCHAR(120),
  region_code VARCHAR(20),
  lat DECIMAL(9,6),
  lng DECIMAL(9,6)
);

CREATE TABLE IF NOT EXISTS case_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  date DATE NOT NULL,
  confirmed_cases INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_case_region_date (region_id, date)
);

CREATE TABLE IF NOT EXISTS climate_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  date DATE NOT NULL,
  temperature DECIMAL(5,2),
  rainfall DECIMAL(6,2),
  humidity DECIMAL(5,2),
  enso_index DECIMAL(5,2),
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_climate_region_date (region_id, date)
);

CREATE TABLE IF NOT EXISTS demographic_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  year INT NOT NULL,
  population INT,
  urban_pct DECIMAL(5,2),
  poverty_rate DECIMAL(5,2),
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_demo_region_year (region_id, year)
);

CREATE TABLE IF NOT EXISTS vector_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  date DATE NOT NULL,
  larval_index DECIMAL(6,2),
  adult_density DECIMAL(6,2),
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS model_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model_type VARCHAR(60) NOT NULL,
  version VARCHAR(30),
  trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hyperparameters_json JSON
);

CREATE TABLE IF NOT EXISTS predictions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id INT NOT NULL,
  region_id INT NOT NULL,
  date DATE NOT NULL,
  predicted_cases DECIMAL(8,2) NOT NULL,
  ci_lower DECIMAL(8,2),
  ci_upper DECIMAL(8,2),
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evaluation_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id INT NOT NULL,
  rmse DECIMAL(8,3),
  mae DECIMAL(8,3),
  mape DECIMAL(6,3),
  crps DECIMAL(8,3),
  coverage DECIMAL(5,2),
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  date DATE NOT NULL,
  risk_level ENUM('low', 'moderate', 'high', 'severe') NOT NULL DEFAULT 'low',
  triggered_by_model_run_id INT,
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by_model_run_id) REFERENCES model_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('researcher', 'health_officer', 'admin') NOT NULL DEFAULT 'researcher',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
