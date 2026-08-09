"""Configuration module for the Python model service."""
import os
from dotenv import load_dotenv

load_dotenv()

# Database Configuration
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'dengue_prediction'),
    'port': int(os.getenv('DB_PORT', 3306)),
    'autocommit': True,
}

# Model Configuration
MODEL_TYPE = os.getenv('MODEL_TYPE', 'hybrid')
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
FORECAST_HORIZON = 12  # Number of months to forecast

# Training Configuration
TRAIN_SPLIT = 0.8
TEST_SPLIT = 0.1
VAL_SPLIT = 0.1
