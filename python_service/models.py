"""Machine learning models for dengue forecasting."""
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, mean_absolute_percentage_error
from scipy import stats
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class BaseModel:
    """Base model class with common functionality."""
    
    def __init__(self):
        self.scaler = StandardScaler()
        self.is_fitted = False
    
    def prepare_data(self, cases_data, horizon=12):
        """Prepare and normalize data for modeling."""
        if not cases_data:
            return None, None
        
        df = pd.DataFrame(cases_data)
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date')
        
        X = df['confirmed_cases'].values.reshape(-1, 1)
        X_scaled = self.scaler.fit_transform(X)
        
        return df, X_scaled
    
    def calculate_metrics(self, y_true, y_pred, y_pred_lower, y_pred_upper):
        """Calculate evaluation metrics."""
        # Point accuracy metrics
        rmse = np.sqrt(mean_squared_error(y_true, y_pred))
        mae = mean_absolute_error(y_true, y_pred)
        mape = mean_absolute_percentage_error(y_true, y_pred)
        
        # Probabilistic metrics
        # CRPS approximation
        z = (y_true - y_pred) / np.maximum(1, y_pred_upper - y_pred_lower)
        crps = np.mean(np.abs(z) * (y_pred_upper - y_pred_lower) / 2)
        
        # Coverage: percentage of observations within prediction interval
        coverage = np.mean((y_true >= y_pred_lower) & (y_true <= y_pred_upper)) * 100
        
        # Mean interval width
        mean_interval_width = np.mean(y_pred_upper - y_pred_lower)
        
        return {
            'rmse': float(rmse),
            'mae': float(mae),
            'mape': float(mape),
            'crps': float(crps),
            'coverage': float(coverage),
            'mean_interval_width': float(mean_interval_width)
        }


class HybridModel(BaseModel):
    """Bayesian-neural hybrid model for dengue prediction."""
    
    def __init__(self):
        super().__init__()
        self.lstm_model = None
        self.bayesian_params = None
    
    def fit(self, cases_data):
        """Fit the hybrid model to training data."""
        df, X_scaled = self.prepare_data(cases_data)
        
        if X_scaled is None or len(X_scaled) < 10:
            logger.warning("Insufficient data for model training")
            return False
        
        # Create sequences for LSTM
        sequence_length = 12
        X_seq, y_seq = [], []
        
        for i in range(len(X_scaled) - sequence_length):
            X_seq.append(X_scaled[i:i+sequence_length])
            y_seq.append(X_scaled[i+sequence_length])
        
        if len(X_seq) < 5:
            logger.warning("Insufficient sequences for LSTM training")
            return False
        
        X_seq = np.array(X_seq)
        y_seq = np.array(y_seq)
        
        # Placeholder for LSTM fitting (simplified for demonstration)
        # In production, use TensorFlow/Keras LSTM
        self.lstm_model = {
            'mean': np.mean(y_seq),
            'std': np.std(y_seq),
            'last_sequence': X_seq[-1]
        }
        
        # Fit Bayesian parameters (Normal distribution)
        self.bayesian_params = {
            'mu': np.mean(X_scaled.flatten()),
            'sigma': np.std(X_scaled.flatten()),
            'alpha': 0.05  # Credible interval level
        }
        
        self.is_fitted = True
        logger.info("Hybrid model fitted successfully")
        return True
    
    def predict(self, horizon=12):
        """Generate predictions with credible intervals."""
        if not self.is_fitted:
            logger.error("Model must be fitted before prediction")
            return None
        
        predictions = []
        current_value = self.lstm_model['mean']
        
        for i in range(horizon):
            # LSTM-inspired prediction with trend
            noise = np.random.normal(0, self.lstm_model['std'] * 0.1)
            forecast = current_value + noise * 0.05
            
            # Bayesian credible interval
            z_score = stats.norm.ppf(1 - self.bayesian_params['alpha']/2)
            margin = z_score * self.bayesian_params['sigma']
            
            # Inverse scale transformation
            forecast_scaled = np.array([[forecast]])
            forecast_actual = self.scaler.inverse_transform(forecast_scaled)[0][0]
            lower_actual = self.scaler.inverse_transform([[forecast - margin]])[0][0]
            upper_actual = self.scaler.inverse_transform([[forecast + margin]])[0][0]
            
            # Ensure non-negative predictions
            forecast_actual = max(0, forecast_actual)
            lower_actual = max(0, lower_actual)
            upper_actual = max(0, upper_actual)
            
            predictions.append({
                'predicted_cases': float(forecast_actual),
                'ci_lower': float(lower_actual),
                'ci_upper': float(upper_actual),
                'date': (datetime.now() + timedelta(weeks=i)).strftime('%Y-%m-%d')
            })
            
            current_value = forecast
        
        return predictions


class SARIMABaseline:
    """SARIMA baseline model."""
    
    def __init__(self):
        self.params = None
    
    def fit(self, cases_data):
        """Fit SARIMA model (simplified version)."""
        if not cases_data or len(cases_data) < 13:
            logger.warning("Insufficient data for SARIMA fitting")
            return False
        
        df = pd.DataFrame(cases_data)
        df['date'] = pd.to_datetime(df['date'])
        values = df['confirmed_cases'].values
        
        # Simplified SARIMA parameters estimation
        self.params = {
            'mean': np.mean(values),
            'std': np.std(values),
            'trend': np.polyfit(range(len(values)), values, 1)[0],
            'seasonal_period': 12
        }
        
        logger.info("SARIMA model fitted successfully")
        return True
    
    def predict(self, horizon=12):
        """Generate predictions."""
        if self.params is None:
            logger.error("Model must be fitted before prediction")
            return None
        
        predictions = []
        current = self.params['mean']
        
        for i in range(horizon):
            forecast = current + self.params['trend'] * 0.5
            # Add confidence interval
            margin = 1.96 * self.params['std']
            
            forecast = max(0, forecast)
            lower = max(0, forecast - margin)
            upper = forecast + margin
            
            predictions.append({
                'predicted_cases': float(forecast),
                'ci_lower': float(lower),
                'ci_upper': float(upper),
                'date': (datetime.now() + timedelta(weeks=i)).strftime('%Y-%m-%d')
            })
            
            current = forecast
        
        return predictions


class LSTMBaseline:
    """LSTM baseline model."""
    
    def __init__(self):
        self.mean = None
        self.std = None
    
    def fit(self, cases_data):
        """Fit LSTM model (simplified version)."""
        if not cases_data or len(cases_data) < 12:
            logger.warning("Insufficient data for LSTM fitting")
            return False
        
        df = pd.DataFrame(cases_data)
        values = df['confirmed_cases'].values
        
        self.mean = np.mean(values)
        self.std = np.std(values)
        
        logger.info("LSTM baseline model fitted successfully")
        return True
    
    def predict(self, horizon=12):
        """Generate predictions."""
        if self.mean is None:
            logger.error("Model must be fitted before prediction")
            return None
        
        predictions = []
        current = self.mean
        
        for i in range(horizon):
            noise = np.random.normal(0, self.std * 0.08)
            forecast = current + noise
            
            margin = 1.96 * self.std * 0.8
            
            forecast = max(0, forecast)
            lower = max(0, forecast - margin)
            upper = forecast + margin
            
            predictions.append({
                'predicted_cases': float(forecast),
                'ci_lower': float(lower),
                'ci_upper': float(upper),
                'date': (datetime.now() + timedelta(weeks=i)).strftime('%Y-%m-%d')
            })
            
            current = forecast
        
        return predictions
