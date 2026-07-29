output "db_rotation_lambda_arn" {
  description = "ARN of the DB password rotation Lambda function"
  value       = aws_lambda_function.db_rotation.arn
}

output "db_rotation_lambda_name" {
  description = "Name of the DB password rotation Lambda function"
  value       = aws_lambda_function.db_rotation.function_name
}

output "jwt_rotation_lambda_arn" {
  description = "ARN of the JWT secret rotation Lambda function"
  value       = aws_lambda_function.jwt_rotation.arn
}

output "jwt_rotation_lambda_name" {
  description = "Name of the JWT secret rotation Lambda function"
  value       = aws_lambda_function.jwt_rotation.function_name
}

output "rotation_alerts_sns_topic_arn" {
  description = "ARN of the SNS topic receiving rotation failure alerts"
  value       = aws_sns_topic.rotation_alerts.arn
}

output "lambda_iam_role_arn" {
  description = "IAM role ARN shared by both rotation Lambda functions"
  value       = aws_iam_role.secrets_rotation_lambda.arn
}
