"""Main entry point for the Python model service."""
import logging
import sys
from config import FORECAST_HORIZON, LOG_LEVEL, MODEL_TYPE
from database import DatabaseConnector
from models import HybridModel, SARIMABaseline, LSTMBaseline

# Setup logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('model_service.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def select_model(model_type):
    """Select and instantiate the appropriate model."""
    if model_type.lower() == 'hybrid':
        return HybridModel(), 'hybrid'
    elif model_type.lower() == 'sarima':
        return SARIMABaseline(), 'SARIMA'
    elif model_type.lower() == 'lstm':
        return LSTMBaseline(), 'LSTM'
    else:
        logger.warning(f"Unknown model type: {model_type}, defaulting to hybrid")
        return HybridModel(), 'hybrid'


def run_forecast_for_region(db, region_id, region_name):
    """Run forecast for a specific region."""
    try:
        logger.info(f"Running forecast for region: {region_name} (ID: {region_id})")
        
        # Get historical data
        cases_data = db.get_cases_for_region(region_id)
        
        if not cases_data:
            logger.warning(f"No case data found for region {region_name}")
            return False
        
        # Select and fit model
        model, model_name = select_model(MODEL_TYPE)
        
        if not model.fit(cases_data):
            logger.error(f"Failed to fit model for region {region_name}")
            return False
        
        # Generate predictions
        predictions = model.predict(FORECAST_HORIZON)
        
        if not predictions:
            logger.error(f"Failed to generate predictions for region {region_name}")
            return False
        
        # Store predictions in database
        db.insert_predictions(region_id, predictions, '1.0', model_name)
        
        logger.info(f"Successfully completed forecast for region {region_name}")
        return True
        
    except Exception as e:
        logger.error(f"Error processing region {region_name}: {str(e)}")
        return False


def run_all_forecasts():
    """Run forecasts for all regions."""
    db = DatabaseConnector()
    
    try:
        db.connect()
        
        # Get all regions
        regions = db.get_all_regions()
        
        if not regions:
            logger.warning("No regions found in database")
            return
        
        success_count = 0
        total_count = len(regions)
        
        for region in regions:
            if run_forecast_for_region(db, region['id'], region['name']):
                success_count += 1
        
        logger.info(f"Forecast run completed: {success_count}/{total_count} regions processed successfully")
        
    except Exception as e:
        logger.error(f"Critical error in model service: {str(e)}")
        sys.exit(1)
    
    finally:
        db.close()


if __name__ == '__main__':
    logger.info("Starting Python model service")
    run_all_forecasts()
    logger.info("Python model service completed")
