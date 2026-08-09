"""Database connection and operations for the model service."""
import mysql.connector
from config import DB_CONFIG
import logging

logger = logging.getLogger(__name__)


class DatabaseConnector:
    """Handle database connections and operations."""
    
    def __init__(self):
        self.connection = None
    
    def connect(self):
        """Establish database connection."""
        try:
            self.connection = mysql.connector.connect(**DB_CONFIG)
            logger.info("Successfully connected to database")
        except mysql.connector.Error as err:
            logger.error(f"Failed to connect to database: {err}")
            raise
    
    def close(self):
        """Close database connection."""
        if self.connection and self.connection.is_connected():
            self.connection.close()
            logger.info("Database connection closed")
    
    def execute_query(self, query, params=None):
        """Execute a SELECT query and return results."""
        cursor = self.connection.cursor(dictionary=True)
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            result = cursor.fetchall()
            return result
        except mysql.connector.Error as err:
            logger.error(f"Query execution error: {err}")
            return None
        finally:
            cursor.close()
    
    def insert_predictions(self, region_id, predictions, version, model_type):
        """Insert model predictions into the database."""
        cursor = self.connection.cursor()
        try:
            for pred in predictions:
                query = """
                INSERT INTO predictions 
                (region_id, date, predicted_cases, ci_lower, ci_upper, version, model_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """
                cursor.execute(query, (
                    region_id,
                    pred['date'],
                    pred['predicted_cases'],
                    pred['ci_lower'],
                    pred['ci_upper'],
                    version,
                    model_type
                ))
            self.connection.commit()
            logger.info(f"Successfully inserted {len(predictions)} predictions")
        except mysql.connector.Error as err:
            logger.error(f"Error inserting predictions: {err}")
            self.connection.rollback()
            raise
        finally:
            cursor.close()
    
    def insert_evaluation_metrics(self, model_run_id, metrics):
        """Insert model evaluation metrics into the database."""
        cursor = self.connection.cursor()
        try:
            query = """
            INSERT INTO evaluation_metrics 
            (model_run_id, rmse, mae, mape, crps, coverage, mean_interval_width)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(query, (
                model_run_id,
                metrics.get('rmse'),
                metrics.get('mae'),
                metrics.get('mape'),
                metrics.get('crps'),
                metrics.get('coverage'),
                metrics.get('mean_interval_width')
            ))
            self.connection.commit()
            logger.info("Successfully inserted evaluation metrics")
        except mysql.connector.Error as err:
            logger.error(f"Error inserting evaluation metrics: {err}")
            self.connection.rollback()
            raise
        finally:
            cursor.close()
    
    def get_cases_for_region(self, region_id):
        """Retrieve case data for a specific region."""
        query = """
        SELECT date, confirmed_cases 
        FROM cases 
        WHERE region_id = %s 
        ORDER BY date ASC
        """
        return self.execute_query(query, (region_id,))
    
    def get_all_regions(self):
        """Retrieve all regions from the database."""
        query = "SELECT id, name, slug FROM regions"
        return self.execute_query(query)
